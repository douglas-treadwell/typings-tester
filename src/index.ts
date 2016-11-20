import * as ts from "typescript";


function handleDiagnostics(type: string, diagnostics: ts.Diagnostic[],
                           bail: boolean = false) {
  const ret = [];

  for (const diagnostic of diagnostics) {
    const {line, character} =
      diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const message =
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

    const text = `${type}: ${diagnostic.file.fileName} ` +
                 `(${line + 1}, ${character + 1}): ${message}`;

    if (bail)
      throw new Error(text);

    ret.push(text);
  }

  return ret;
}

function forEachExpectedFailureNodes(node: ts.Node,
                                     cb: (node: ts.Node) => void) {
  if (node.kind !== ts.SyntaxKind.SourceFile &&
      node.getFullText().match(/^\s*\/[\/*] typings:expect-error/)) {
    cb(node);
  } else {
    ts.forEachChild(node, child => {
      forEachExpectedFailureNodes(child, cb);
    });
  }
}


export function check(files: string[], tsConfigPath: string,
                      bail: boolean = false) {
  const {config, error} = ts.readConfigFile(tsConfigPath, ts.sys.readFile);

  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }

  const program = ts.createProgram(files, config.compilerOptions);

  const allErrors = [];

  const global = handleDiagnostics('Global',
    program.getGlobalDiagnostics(), bail);
  const syntax = handleDiagnostics('Syntactic',
    program.getSyntacticDiagnostics(), bail);

  allErrors.push(...global, ...syntax);

  for (const sourceFile of program.getSourceFiles()) {
    let semantic = program.getSemanticDiagnostics(sourceFile);

    if (program.getRootFileNames().indexOf(sourceFile.fileName) !== -1) {
      forEachExpectedFailureNodes(sourceFile, node => {
        const failures: ts.Diagnostic[] = [];
        const leftSemantics: ts.Diagnostic[] = [];

        for (const diag of semantic) {
          if (node.pos <= diag.start && diag.start + diag.length <= node.end) {
            failures.push(diag);
          } else {
            leftSemantics.push(diag);
          }
        }

        if (failures.length === 0) {
          const {line, character} =
            sourceFile.getLineAndCharacterOfPosition(node.getStart());
          const message = `Expected error: ${sourceFile.fileName} ` +
                          `(${line + 1}, ${character + 1}):\n` +
                          node.getText();

          if (bail)
            throw new Error(message);

          allErrors.push(message);
        }

        semantic = leftSemantics;
      });
    }

    allErrors.push(...handleDiagnostics('Semantic', semantic, bail));
  }

  if (allErrors.length > 0)
    throw new Error(allErrors.join('\n\n'));
}

export function checkDirectory(path: string, bail: boolean = false) {
  const files = ts.sys.readDirectory(path, ['.ts', '.tsx']);
  const tsConfigPath = ts.findConfigFile(path, ts.sys.fileExists);

  check(files, tsConfigPath, bail);
}

