import { readFileSync, writeFileSync } from "node:fs";
import { resolveProjectPath } from "../core/project-root";
import { SCHEMA_INSERCOES } from "../tools/memoria/contrato-escrita";

// Mantém o schema visível aos dois curadores idêntico ao contrato em código.
for (const agent of ["curador-call"]) {
  const path = resolveProjectPath("src", "agents", agent, "tools", "memoria_preparar_candidato.md");
  const content = readFileSync(path, "utf8");
  const match = content.match(/^parameters: (.+)$/m);
  if (!match?.[1]) throw new Error(`Schema ausente: ${path}`);
  const schema = JSON.parse(match[1]);
  schema.additionalProperties = false;
  schema.properties.versao = { type: "integer", const: 2 };
  schema.properties.alteracoes = SCHEMA_INSERCOES;
  schema.properties.evidencias.items.maxLength = 240;
  schema.required = [...new Set(["versao", ...schema.required])];
  const updated = content.replace(/^parameters: .+$/m, `parameters: ${JSON.stringify(schema)}`);
  writeFileSync(path, updated, "utf8");
}
