import luau, { renderAST } from "@roblox-ts/luau-ast";
import { RojoResolver } from "@roblox-ts/rojo-resolver";
import { readFileSync } from "fs-extra";
import { sync } from "glob";
import { PATH_SEP, pathJoin, VirtualFileSystem } from "Project/classes/VirtualFileSystem";
import { validateCompilerOptions } from "Project/functions/validateCompilerOptions";
import { getCustomPreEmitDiagnostics } from "Project/util/getCustomPreEmitDiagnostics";
import { satisfies } from "semver";
import { PathTranslator } from "Shared/classes/PathTranslator";
import { COMPILER_VERSION, DEFAULT_PROJECT_OPTIONS, NODE_MODULES, ProjectType, RBXTS_SCOPE } from "Shared/constants";
import { DiagnosticError } from "Shared/errors/DiagnosticError";
import { ProjectData } from "Shared/types";
import { assert } from "Shared/util/assert";
import { hasErrors } from "Shared/util/hasErrors";
import { MultiTransformState, transformSourceFile, TransformState } from "TSTransformer";
import { DiagnosticService } from "TSTransformer/classes/DiagnosticService";
import { createTransformServices } from "TSTransformer/util/createTransformServices";
import ts from "typescript";

const PROJECT_DIR = PATH_SEP;
const ROOT_DIR = pathJoin(PROJECT_DIR, "src");
const OUT_DIR = pathJoin(PROJECT_DIR, "out");
const PLAYGROUND_PATH = pathJoin(ROOT_DIR, "playground.tsx");
const NODE_MODULES_PATH = pathJoin(PROJECT_DIR, NODE_MODULES);
const RBXTS_SCOPE_PATH = pathJoin(NODE_MODULES_PATH, RBXTS_SCOPE);
const INCLUDE_PATH = pathJoin(PROJECT_DIR, "include");

export class VirtualProject {
	private readonly data: ProjectData;

	public readonly vfs: VirtualFileSystem;

	private readonly compilerOptions: ts.CompilerOptions;
	private readonly rojoResolver: RojoResolver;
	private readonly pkgRojoResolvers: Array<RojoResolver>;
	private readonly compilerHost: ts.CompilerHost;

	private program: ts.Program | undefined;
	private typeChecker: ts.TypeChecker | undefined;
	private nodeModulesPathMapping = new Map<string, string>();

	constructor() {
		this.data = {
			includePath: "",
			isPackage: false,
			logTruthyChanges: false,
			nodeModulesPath: NODE_MODULES_PATH,
			noInclude: false,
			projectOptions: Object.assign({}, DEFAULT_PROJECT_OPTIONS, {
				rojo: "",
				type: ProjectType.Model,
			}),
			projectPath: PROJECT_DIR,
			rojoConfigPath: undefined,
			tsConfigPath: "",
			writeOnlyChanged: false,
			optimizedLoops: false,
			watch: false,
		};

		this.compilerOptions = {
			allowSyntheticDefaultImports: true,
			downlevelIteration: true,
			noLib: true,
			strict: true,
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.CommonJS,
			moduleResolution: ts.ModuleResolutionKind.NodeJs,
			moduleDetection: ts.ModuleDetectionKind.Force,
			typeRoots: [RBXTS_SCOPE_PATH],
			resolveJsonModule: true,
			experimentalDecorators: true,
			rootDir: ROOT_DIR,
			outDir: OUT_DIR,
			jsx: ts.JsxEmit.React,
			jsxFactory: "Roact.createElement",
			jsxFragmentFactory: "Roact.Fragment",
		};
		validateCompilerOptions(this.compilerOptions, this.data.nodeModulesPath);

		this.vfs = new VirtualFileSystem();

		const system = {
			getExecutingFilePath: () => __filename,
			getCurrentDirectory: () => "/",
		} as ts.System;

		this.compilerHost = ts.createCompilerHostWorker(this.compilerOptions, undefined, system);
		this.compilerHost.readFile = filePath => this.vfs.readFile(filePath);
		this.compilerHost.fileExists = filePath => this.vfs.fileExists(filePath);
		this.compilerHost.directoryExists = dirPath => this.vfs.directoryExists(dirPath);
		this.compilerHost.getDirectories = dirPath => this.vfs.getDirectories(dirPath);
		this.compilerHost.useCaseSensitiveFileNames = () => true;
		this.compilerHost.getCurrentDirectory = () => PATH_SEP;

		this.rojoResolver = RojoResolver.fromTree(PROJECT_DIR, {
			$path: OUT_DIR,
			include: {
				$path: INCLUDE_PATH,
				node_modules: {
					$path: RBXTS_SCOPE_PATH,
				},
			},
		} as never);
		this.pkgRojoResolvers = this.compilerOptions.typeRoots!.map(RojoResolver.synthetic);

		// this.loadPlugins();
	}

	public loadPlugins() {
		this.compilerOptions.typeRoots
			// Grab all package.json files in typeRoots directories
			?.map(typeRoot =>
				sync(`${typeRoot}/*/package.json`).map(filePath => JSON.parse(readFileSync(filePath, "utf8"))),
			)
			.flat()
			// Filter to those with a JavaScript plugin field
			.filter(({ plugin }) => plugin?.endsWith(ts.Extension.Js))
			// Filter to compiler compatible versions
			.filter(({ engines }) => satisfies(engines?.["roblox-ts"], COMPILER_VERSION))
			// Filter to plugin scripts that return a single function
			.map(require)
			.filter(plugin => typeof plugin === "function")
			// Call the plugins
			.forEach(plugin =>
				plugin({
					dependencies: {
						ts,
						luau,
					},
					services: {
						tsProgram: this.program,
						diagnosticService: DiagnosticService,
					},
					options: {
						compilerOptions: this.compilerOptions,
						projectOptions: this.data.projectOptions,
					},
					registration: {},
				}),
			);
	}

	public compileSource(source: string) {
		this.vfs.writeFile(PLAYGROUND_PATH, source);

		const rootNames = this.vfs
			.getFilePaths()
			.filter(v => v.endsWith(ts.Extension.Ts) || v.endsWith(ts.Extension.Tsx) || v.endsWith(ts.Extension.Dts));
		this.program = ts.createProgram(rootNames, this.compilerOptions, this.compilerHost, this.program);
		this.typeChecker = this.program.getTypeChecker();

		const services = createTransformServices(this.program, this.typeChecker, this.data);
		const pathTranslator = new PathTranslator(ROOT_DIR, OUT_DIR, undefined, false);

		const sourceFile = this.program.getSourceFile(PLAYGROUND_PATH);
		assert(sourceFile);

		const diagnostics = new Array<ts.Diagnostic>();
		diagnostics.push(...ts.getPreEmitDiagnostics(this.program, sourceFile));
		diagnostics.push(...getCustomPreEmitDiagnostics(this.data, sourceFile));
		if (hasErrors(diagnostics)) throw new DiagnosticError(diagnostics);

		const multiTransformState = new MultiTransformState();

		const runtimeLibRbxPath = undefined;
		const projectType = this.data.projectOptions.type!;

		const transformState = new TransformState(
			this.data,
			services,
			pathTranslator,
			multiTransformState,
			this.compilerOptions,
			this.rojoResolver,
			this.pkgRojoResolvers,
			this.nodeModulesPathMapping,
			new Map(),
			runtimeLibRbxPath,
			this.typeChecker,
			projectType,
			sourceFile,
		);

		const luaAST = transformSourceFile(transformState, sourceFile);
		diagnostics.push(...DiagnosticService.flush());
		if (hasErrors(diagnostics)) throw new DiagnosticError(diagnostics);

		const luaSource = renderAST(luaAST);
		return luaSource;
	}

	public setMapping(typings: string, main: string) {
		this.nodeModulesPathMapping.set(typings, main);
	}
}
