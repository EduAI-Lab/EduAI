import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/**
 * Ban the case-insensitive substring "shape" in every symbol this codebase declares.
 *
 * Only declaration positions are visited. Member reads (`payload.shape`), imported
 * names, JSX element and attribute names, and object-literal keys all name something
 * defined elsewhere, so flagging them would demand a rename the author cannot make.
 */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in declared JavaScript, TypeScript, and private symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportName = (node: ESTree.Node, name: string) => {
      if (!containsForbiddenSymbolName(name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name },
      });
    };

    // Binding patterns introduce local names, so every identifier reachable through
    // one is declared here. In `{ shape: form }` only `form` is the binding.
    const reportBindings = (node: ESTree.Node | null | undefined): void => {
      if (!node) return;
      switch (node.type) {
        case "Identifier":
          reportName(node, node.name);
          return;
        case "ObjectPattern":
          for (const property of node.properties) {
            reportBindings(property.type === "Property" ? property.value : property.argument);
          }
          return;
        case "ArrayPattern":
          for (const element of node.elements) reportBindings(element);
          return;
        case "AssignmentPattern":
          reportBindings(node.left);
          return;
        case "RestElement":
          reportBindings(node.argument);
          return;
        case "TSParameterProperty":
          reportBindings(node.parameter);
          return;
        default:
          return;
      }
    };

    const reportParameters = (node: ESTree.Node) => {
      if (!("params" in node)) return;
      for (const parameter of node.params) reportBindings(parameter);
    };

    const reportDeclarationId = (node: ESTree.Node) => {
      if (!("id" in node)) return;
      const id = node.id;
      if (id && typeof id === "object" && "type" in id && id.type === "Identifier") {
        reportName(id, id.name);
      }
    };

    const reportFunction = (node: ESTree.Node) => {
      reportDeclarationId(node);
      reportParameters(node);
    };

    const reportMemberKey = (node: ESTree.Node) => {
      if (!("key" in node) || !("computed" in node) || node.computed) return;
      const key = node.key;
      if (key.type !== "Identifier" && key.type !== "PrivateIdentifier") return;
      reportName(key, key.name);
    };

    return {
      VariableDeclarator: (node) => {
        if (node.type === "VariableDeclarator") reportBindings(node.id);
      },

      ArrowFunctionExpression: reportParameters,
      FunctionDeclaration: reportFunction,
      FunctionExpression: reportFunction,
      TSDeclareFunction: reportFunction,
      TSCallSignatureDeclaration: reportParameters,
      TSConstructSignatureDeclaration: reportParameters,
      TSConstructorType: reportParameters,
      TSFunctionType: reportParameters,

      ClassDeclaration: reportDeclarationId,
      ClassExpression: reportDeclarationId,
      MethodDefinition: reportMemberKey,
      PropertyDefinition: reportMemberKey,
      TSAbstractMethodDefinition: reportMemberKey,
      TSAbstractPropertyDefinition: reportMemberKey,

      TSTypeAliasDeclaration: reportDeclarationId,
      TSInterfaceDeclaration: reportDeclarationId,
      TSEnumDeclaration: reportDeclarationId,
      TSEnumMember: reportDeclarationId,
      TSModuleDeclaration: reportDeclarationId,
      TSPropertySignature: reportMemberKey,
      TSMethodSignature: reportMemberKey,
      TSTypeParameter: (node) => {
        if (node.type === "TSTypeParameter") reportName(node.name, node.name.name);
      },
    };
  },
});
