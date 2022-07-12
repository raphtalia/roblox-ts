import luau from "@roblox-ts/luau-ast";
import { EventEmitter } from "events";
import { existsSync, readFileSync } from "fs-extra";
import { sync } from "glob";
import { dirname, join } from "path";
import { satisfies } from "semver";
import { PathTranslator } from "Shared/classes/PathTranslator";
import { COMPILER_VERSION } from "Shared/constants";
import { ProjectData, ProjectOptions } from "Shared/types";
import { DiagnosticService } from "TSTransformer/classes/DiagnosticService";
import ts from "typescript";

export interface CompilerPluginOptions {
	dependencies: {
		ts: typeof ts;
		luau: typeof luau;
	};
	services: {
		tsProgram: ts.Program;
		diagnosticService: DiagnosticService;
	};
	options: {
		compilerOptions: ts.CompilerOptions;
		projectOptions: ProjectOptions;
	};
	registration: unknown;
}

export class PluginManager extends EventEmitter {
	constructor(
		public tsProgram: ts.Program,
		public readonly projectData: ProjectData,
		public pathTranslator: PathTranslator,
	) {
		super();
	}

	public async loadPlugins() {
		const compilerOptions = this.tsProgram.getCompilerOptions();

		if (!compilerOptions.typeRoots) return;

		(
			await Promise.all(
				compilerOptions.typeRoots
					// Grab all package.json files in typeRoots directories
					.map(typeRoot =>
						sync(`${typeRoot}/*/package.json`).map(filePath => ({
							pkgPath: dirname(filePath),
							pkgJson: JSON.parse(readFileSync(filePath, "utf8")),
						})),
					)
					.flat()

					// Filter to those with a JavaScript plugin field and have a
					// compatible compiler version
					.filter(
						({ pkgJson }) =>
							pkgJson.plugin?.endsWith(ts.Extension.Js) &&
							satisfies(COMPILER_VERSION, pkgJson.engines?.["roblox-ts"]),
					)

					// Convert to path and check path exists
					.map(({ pkgPath, pkgJson }) => join(pkgPath, pkgJson.plugin))
					.filter(pluginPath => existsSync(pluginPath))

					// Import default exports from modules
					.map(async pluginPath => (await import(pluginPath)).default),
			)
		)

			// Filter to plugin scripts that return a single function
			.filter(plugin => typeof plugin === "function")

			// Call the plugins
			.forEach(plugin =>
				plugin({
					dependencies: {
						ts,
						luau,
					},
					services: {
						tsProgram: this.tsProgram,
						diagnosticService: DiagnosticService,
						pathTranslator: this.pathTranslator,
						pluginManager: this,
					},
					options: {
						compilerOptions: compilerOptions,
						projectOptions: this.projectData.projectOptions,
					},
					registration: {},
				} as CompilerPluginOptions),
			);
	}

	public runInitialCompile(sourceFiles: Array<ts.SourceFile>) {
		this.emit("initialCompile", sourceFiles);
	}

	public runIncrementalCompile(additions: Set<string>, changes: Set<string>, removals: Set<string>) {
		this.emit("incrementalCompile", additions, changes, removals);
	}
}
