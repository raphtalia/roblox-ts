import ts from "byots";
import * as lua from "LuaAST";
import { TransformState } from "TSTransformer";
import { diagnostics } from "TSTransformer/diagnostics";
import { transformObjectBindingPattern } from "TSTransformer/nodes/binding/transformObjectBindingPattern";
import { transformVariable } from "TSTransformer/nodes/statements/transformVariableStatement";
import { getAccessorForBindingType } from "TSTransformer/util/binding/getAccessorForBindingType";
import { pushToVar } from "TSTransformer/util/pushToVar";
import { transformInitializer } from "TSTransformer/util/transformInitializer";
import { assert } from "Shared/util/assert";

export function transformArrayBindingPattern(
	state: TransformState,
	bindingPattern: ts.ArrayBindingPattern,
	parentId: lua.AnyIdentifier,
) {
	let index = 0;
	const idStack = new Array<lua.AnyIdentifier>();
	const accessor = getAccessorForBindingType(state, bindingPattern, state.getType(bindingPattern));
	for (const element of bindingPattern.elements) {
		if (ts.isOmittedExpression(element)) {
			accessor(state, parentId, index, idStack, true);
		} else {
			if (element.dotDotDotToken) {
				state.addDiagnostic(diagnostics.noDotDotDotDestructuring(element));
				return;
			}
			const name = element.name;
			const rhs = accessor(state, parentId, index, idStack, false);
			if (ts.isIdentifier(name)) {
				const { expression: id, statements } = transformVariable(state, name, rhs);
				state.prereqList(statements);
				assert(lua.isAnyIdentifier(id));
				if (element.initializer) {
					state.prereq(transformInitializer(state, id, element.initializer));
				}
			} else {
				const id = pushToVar(state, rhs);
				if (element.initializer) {
					state.prereq(transformInitializer(state, id, element.initializer));
				}
				if (ts.isArrayBindingPattern(name)) {
					transformArrayBindingPattern(state, name, id);
				} else {
					transformObjectBindingPattern(state, name, id);
				}
			}
		}
		index++;
	}
}
