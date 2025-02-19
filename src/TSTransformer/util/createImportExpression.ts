import luau from "@roblox-ts/luau-ast";
import { FileRelation, NetworkType, RbxPath, RbxPathParent, RbxType, RojoResolver } from "@roblox-ts/rojo-resolver";
import path from "path";
import { PARENT_FIELD, ProjectType } from "Shared/constants";
import { errors, warnings } from "Shared/diagnostics";
import { assert } from "Shared/util/assert";
import { getCanonicalFileName } from "Shared/util/getCanonicalFileName";
import { TransformState } from "TSTransformer";
import { DiagnosticService } from "TSTransformer/classes/DiagnosticService";
import { createGetService } from "TSTransformer/util/createGetService";
import { propertyAccessExpressionChain } from "TSTransformer/util/expressionChain";
import { getSourceFileFromModuleSpecifier } from "TSTransformer/util/getSourceFileFromModuleSpecifier";
import ts from "typescript";

function getAbsoluteImport(moduleRbxPath: RbxPath) {
	const pathExpressions = new Array<luau.Expression>();
	const serviceName = moduleRbxPath[0];
	assert(serviceName);
	pathExpressions.push(createGetService(serviceName));
	for (let i = 1; i < moduleRbxPath.length; i++) {
		pathExpressions.push(luau.string(moduleRbxPath[i]));
	}
	return pathExpressions;
}

function getRelativeImport(sourceRbxPath: RbxPath, moduleRbxPath: RbxPath) {
	const relativePath = RojoResolver.relative(sourceRbxPath, moduleRbxPath);

	// create descending path pieces
	const path = new Array<string>();
	let i = 0;
	while (relativePath[i] === RbxPathParent) {
		path.push(PARENT_FIELD);
		i++;
	}

	const pathExpressions: Array<luau.Expression> = [propertyAccessExpressionChain(luau.globals.script, path)];

	// create descending path pieces
	for (; i < relativePath.length; i++) {
		const pathPart = relativePath[i];
		assert(typeof pathPart === "string");
		pathExpressions.push(luau.string(pathPart));
	}

	return pathExpressions;
}

function validateModule(state: TransformState, scope: string) {
	const scopedModules = path.join(state.data.nodeModulesPath, scope);
	if (state.compilerOptions.typeRoots) {
		for (const typeRoot of state.compilerOptions.typeRoots) {
			if (path.normalize(scopedModules) === path.normalize(typeRoot)) {
				return true;
			}
		}
	}
	return false;
}

function findRelativeRbxPath(moduleOutPath: string, pkgRojoResolvers: Array<RojoResolver>) {
	for (const pkgRojoResolver of pkgRojoResolvers) {
		const relativeRbxPath = pkgRojoResolver.getRbxPathFromFilePath(moduleOutPath);
		if (relativeRbxPath) {
			return relativeRbxPath;
		}
	}
}

function getNodeModulesImportParts(
	state: TransformState,
	sourceFile: ts.SourceFile,
	moduleSpecifier: ts.Expression,
	moduleOutPath: string,
	moduleRbxPath: RbxPath,
) {
	const moduleScope = path.relative(state.data.nodeModulesPath, moduleOutPath).split(path.sep)[0];
	assert(moduleScope);

	if (!moduleScope.startsWith("@")) {
		DiagnosticService.addDiagnostic(errors.noUnscopedModule(moduleSpecifier));
		return [];
	}

	if (!validateModule(state, moduleScope)) {
		DiagnosticService.addDiagnostic(errors.noInvalidModule(moduleSpecifier));
		return [];
	}

	if (state.projectType === ProjectType.Package) {
		const relativeRbxPath = findRelativeRbxPath(moduleOutPath, state.pkgRojoResolvers);
		if (!relativeRbxPath) {
			DiagnosticService.addDiagnostic(
				errors.noRojoData(moduleSpecifier, path.relative(state.data.projectPath, moduleOutPath), true),
			);
			return [];
		}

		const moduleName = relativeRbxPath[0];
		assert(moduleName);

		return [
			propertyAccessExpressionChain(
				luau.call(state.TS(moduleSpecifier.parent, "getModule"), [
					luau.globals.script,
					luau.string(moduleScope),
					luau.string(moduleName),
				]),
				relativeRbxPath.slice(1),
			),
		];
	} else {
		if (!moduleRbxPath.includes(moduleScope)) {
			DiagnosticService.addDiagnostic(
				errors.noPackageImportWithoutScope(
					moduleSpecifier,
					path.relative(state.data.projectPath, moduleOutPath),
					moduleRbxPath,
				),
			);
			return [];
		}

		if (moduleRbxPath[0] === "ReplicatedFirst") {
			DiagnosticService.addDiagnostic(warnings.packageUsedInReplicatedFirst(moduleSpecifier));
		}

		return getImportParts(state, sourceFile, moduleSpecifier, moduleOutPath, moduleRbxPath);
	}
}

function getImportParts(
	state: TransformState,
	sourceFile: ts.SourceFile,
	moduleSpecifier: ts.Expression,
	moduleOutPath: string,
	moduleRbxPath: RbxPath,
) {
	const moduleRbxType = state.rojoResolver.getRbxTypeFromFilePath(moduleOutPath);
	if (moduleRbxType === RbxType.Script || moduleRbxType === RbxType.LocalScript) {
		DiagnosticService.addDiagnostic(errors.noNonModuleImport(moduleSpecifier));
		return [];
	}

	const sourceOutPath = state.pathTranslator.getOutputPath(sourceFile.fileName);
	const sourceRbxPath = state.rojoResolver.getRbxPathFromFilePath(sourceOutPath);
	if (!sourceRbxPath) {
		DiagnosticService.addDiagnostic(
			errors.noRojoData(sourceFile, path.relative(state.data.projectPath, sourceOutPath), false),
		);
		return [];
	}

	if (state.projectType === ProjectType.Game) {
		if (
			state.rojoResolver.getNetworkType(moduleRbxPath) === NetworkType.Server &&
			state.rojoResolver.getNetworkType(sourceRbxPath) !== NetworkType.Server
		) {
			DiagnosticService.addDiagnostic(errors.noServerImport(moduleSpecifier));
			return [];
		}

		const fileRelation = state.rojoResolver.getFileRelation(sourceRbxPath, moduleRbxPath);
		if (fileRelation === FileRelation.OutToOut || fileRelation === FileRelation.InToOut) {
			return getAbsoluteImport(moduleRbxPath);
		} else if (fileRelation === FileRelation.InToIn) {
			return getRelativeImport(sourceRbxPath, moduleRbxPath);
		} else {
			DiagnosticService.addDiagnostic(errors.noIsolatedImport(moduleSpecifier));
			return [];
		}
	} else {
		return getRelativeImport(sourceRbxPath, moduleRbxPath);
	}
}

export function createImportExpression(
	state: TransformState,
	sourceFile: ts.SourceFile,
	moduleSpecifier: ts.Expression,
): luau.IndexableExpression {
	const moduleFile = getSourceFileFromModuleSpecifier(state.typeChecker, moduleSpecifier);
	if (!moduleFile) {
		DiagnosticService.addDiagnostic(errors.noModuleSpecifierFile(moduleSpecifier));
		return luau.none();
	}

	const virtualPath = state.guessVirtualPath(moduleFile.fileName);
	const isInsideNodeModules = ts.isInsideNodeModules(virtualPath);

	const moduleOutPath = isInsideNodeModules
		? state.pathTranslator.getImportPath(
				state.nodeModulesPathMapping.get(getCanonicalFileName(path.normalize(virtualPath))) ?? virtualPath,
				/* isNodeModule */ true,
		  )
		: state.pathTranslator.getImportPath(virtualPath);

	const moduleRbxPath = state.rojoResolver.getRbxPathFromFilePath(moduleOutPath);
	if (!moduleRbxPath) {
		DiagnosticService.addDiagnostic(
			errors.noRojoData(
				moduleSpecifier,
				path.relative(state.data.projectPath, moduleOutPath),
				isInsideNodeModules,
			),
		);
		return luau.none();
	}

	const parts = new Array<luau.Expression>();
	parts.push(luau.globals.script);

	if (isInsideNodeModules) {
		parts.push(...getNodeModulesImportParts(state, sourceFile, moduleSpecifier, moduleOutPath, moduleRbxPath));
	} else {
		parts.push(...getImportParts(state, sourceFile, moduleSpecifier, moduleOutPath, moduleRbxPath));
	}

	return luau.call(state.TS(moduleSpecifier.parent, "import"), parts);
}
