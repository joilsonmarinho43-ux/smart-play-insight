// Cópia espelhada de src/modules/superbet-connect/parser/textParser.ts
// para uso dentro de edge functions (Deno não acessa /src). Mantenha
// sincronizado — fonte canônica é a versão em src/.
//
// Próxima fase vai introduzir um build step para evitar duplicação.

export { parseSuperbetPayload, PARSER_VERSION } from "../../../src/modules/superbet-connect/parser/textParser.ts";
