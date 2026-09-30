import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Processo isolado: nenhuma escrita ou consulta no bundle pessoal.
if (!process.argv.includes("--fixture")) {
  const root = mkdtempSync(join(tmpdir(), "gudy-writing-"));
  for (const file of ["package.json", "src/agents/registry.ts", "discordbot/pyproject.toml"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), file.endsWith("json") ? "{}" : "");
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--fixture"], {
    env: { ...process.env, GUDYBRAIN_ROOT: root }, encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { compilarInsercoes, revisaoMemoria } = await import("../tools/memoria/contrato-escrita");
  const { preencherDocumentoCandidato } = await import("../tools/memoria/preencher");
  const { memoriaCriar, memoriaAtualizar } = await import("../tools/memoria/escrever");
  const { memoriaPrepararCandidato, obterFila, limparFila } = await import("../tools/memoria/candidato");
  const { parseFrontmatter } = await import("../tools/memoria/frontmatter");
  const { ESTRUTURAS_MEMORIA, erroEstruturaCorpo } = await import("../tools/memoria/estrutura");
  const { resolverCaminho } = await import("../tools/memoria/caminhos");
  const { serializarValorMemoria, interpretarValorMemoria } = await import("../tools/memoria/valores-yaml");
  const noReference = () => undefined;
  const change = (secao: string, texto: string) => ({ secao, modo: "acrescentar", itens: [{ tipo: "fato", texto }] });
  for (const value of ['null', 'true', '.nan', '.inf', '2026-01-01', 'Nome: "x", # y', "O'Brien", '[a]', 'a\\b', ['a,b', 'null', "O'Brien"]]) {
    assert.deepEqual(interpretarValorMemoria(serializarValorMemoria(value)), value);
  }
  assert.throws(() => serializarValorMemoria("x\nid: intruso"));
  for (const invalid of [
    [{ secao: "Notas", modo: "acrescentar", conteudo: "Markdown" }],
    [change("Inventada", "x")],
    [{ ...change("Notas", "x"), modo: "apagar" }],
    [change("Notas", "x\n## Intrusa")],
    [change("Notas", "obs_00001")],
    [{ secao: "Notas", modo: "acrescentar", itens: [] }],
    [change("Notas", "x"), change("Notas", "y")],
  ]) assert.throws(() => compilarInsercoes("Lugar", invalid, noReference));
  assert.throws(() => compilarInsercoes("Pessoa", [change("Interesses", "x")], noReference));
  assert.throws(() => compilarInsercoes("Pessoa", [{ secao: "Relações", modo: "acrescentar", itens: [{ tipo: "relacao", alvo_id: "inexistente", percepcoes: ["Leal"] }] }], noReference));
  const escaped = compilarInsercoes("Lugar", [change("Notas", "# <b>[link](https://example.com)</b>")], noReference)[0]!;
  assert.ok(escaped.conteudo.includes("&lt;b&gt;"));
  assert.ok(!escaped.conteudo.includes("[link]("));
  const interest = compilarInsercoes("Pessoa", [{ secao: "Interesses", modo: "acrescentar", itens: [{ tipo: "interesse", nome: "<b>xadrez</b>" }] }], noReference);
  assert.ok(!interest[0]!.conteudo.includes("<b>"));

  // Todos os tipos têm pastas, campos e ordem definidos pelo mesmo catálogo.
  for (const structure of ESTRUTURAS_MEMORIA) {
    const document = preencherDocumentoCandidato({ type: structure.type, frontmatter: { title: `Teste: ${structure.type}` }, alteracoes: [] });
    assert.equal(erroEstruturaCorpo(structure.type, document.corpo), undefined);
    const result = await memoriaCriar({ path: `${structure.pasta}/teste`, frontmatter: document.frontmatter, corpo: document.corpo });
    assert.ok(result.startsWith("Criado:"), result);
    assert.equal(parseFrontmatter(readFileSync(resolverCaminho(`${structure.pasta}/teste.md`), "utf8")).campos.title, `Teste: ${structure.type}`);
  }
  const path = "social/pessoas/teste.md";
  let original = readFileSync(resolverCaminho(path), "utf8");
  const id = String(parseFrontmatter(original).campos.id);
  const target = { id, type: "Pessoa", title: "Pessoa: [teste]", path };
  const relation = compilarInsercoes("Pessoa", [{ secao: "Relações", modo: "acrescentar", itens: [{ tipo: "relacao", alvo_id: id, percepcoes: ["Considera leal."] }] }], () => target);
  assert.ok(relation[0]!.conteudo.includes(`](/${path})`));
  assert.throws(() => compilarInsercoes("Pessoa", [{ secao: "Relações", modo: "acrescentar", itens: [{ tipo: "relacao", alvo_id: id, percepcoes: ["Leal"] }] }], () => ({ ...target, type: "Lugar" })));

  const args = { versao: 2, acao: "atualizar", path, tipo_memoria: "Pessoa", frontmatter: {},
    alteracoes: [change("Histórico", "Não gosta de café."), { secao: "Interesses", modo: "acrescentar", itens: [{ tipo: "interesse", nome: "Xadrez" }] }],
    motivo: "Fato explícito", natureza_proposta: "explicita", evidencias: ["Prefiro chá a café."] };
  assert.ok((await memoriaPrepararCandidato(args)).startsWith("Candidato"));
  const proposal = obterFila()[0]!;
  assert.equal(proposal.baseRevision, revisaoMemoria(original));
  assert.equal(readFileSync(resolverCaminho(path), "utf8"), original, "preparar não pode escrever");
  const updated = await memoriaAtualizar({ path, frontmatter: proposal.frontmatter, corpo: proposal.corpo }, { expectedRevision: proposal.baseRevision });
  assert.ok(updated.startsWith("Atualizado:"), updated);
  const current = readFileSync(resolverCaminho(path), "utf8");
  assert.equal(parseFrontmatter(current).campos.id, id);
  assert.ok(current.includes("Não gosta de café."));
  assert.ok((await memoriaAtualizar({ path, corpo: proposal.corpo }, { expectedRevision: proposal.baseRevision })).includes("conflito"));
  assert.equal(readFileSync(resolverCaminho(path), "utf8"), current);
  const appended = preencherDocumentoCandidato({ type: "Pessoa", frontmatter: {}, conteudoAtual: current,
    alteracoes: compilarInsercoes("Pessoa", [change("Histórico", "gosta de café.")], noReference) });
  assert.ok(appended.corpo.includes("Não gosta de café.") && appended.corpo.includes("- gosta de café."));
  for (const frontmatter of [{ afinidade: 99 }, { title: null }, { type: "Lugar" }, { id: "alterado" }, { tags: ["x\ny"] }]) {
    assert.ok((await memoriaAtualizar({ path, frontmatter }, { expectedRevision: revisaoMemoria(current) })).startsWith("Erro:"));
    assert.equal(readFileSync(resolverCaminho(path), "utf8"), current);
  }
  assert.ok((await memoriaAtualizar({ path, corpo: appended.corpo })).includes("conflito"));
  const duplicate = await memoriaCriar({ path, frontmatter: proposal.frontmatter, corpo: proposal.corpo });
  assert.ok(duplicate.startsWith("Erro:"));
  assert.equal(readFileSync(resolverCaminho(path), "utf8"), current);
  assert.ok((await memoriaCriar({ path: "lugares/pessoa", frontmatter: proposal.frontmatter, corpo: proposal.corpo })).startsWith("Erro:"));
  assert.ok((await memoriaCriar({ path: "social/pessoas/index", frontmatter: proposal.frontmatter, corpo: proposal.corpo })).startsWith("Erro:"));
  writeFileSync(resolverCaminho(".write.lock"), "teste");
  assert.ok((await memoriaAtualizar({ path, corpo: appended.corpo }, { expectedRevision: revisaoMemoria(current) })).includes("ocupada"));
  unlinkSync(resolverCaminho(".write.lock"));
  limparFila();
  for (const invalid of [{ ...args, versao: 1 }, { ...args, corpo: "livre" }, { ...args, acao: "apagar" }, { ...args, frontmatter: { id } }]) {
    assert.ok((await memoriaPrepararCandidato(invalid)).startsWith("Erro:"));
    assert.equal(obterFila().length, 0);
  }
  assert.ok(!existsSync(resolverCaminho("social/pessoas/index.md")));
  const renamed = await memoriaAtualizar({ path_origem: path, path: "social/pessoas/renomeada", corpo: appended.corpo }, { expectedRevision: revisaoMemoria(current) });
  assert.ok(renamed.startsWith("Atualizado e renomeado:"), renamed);
  assert.ok(!existsSync(resolverCaminho(path)));
  assert.equal(parseFrontmatter(readFileSync(resolverCaminho("social/pessoas/renomeada.md"), "utf8")).campos.id, id);
  const outside = mkdtempSync(join(tmpdir(), "gudy-outside-"));
  const junction = join(resolverCaminho(""), "externo");
  symlinkSync(outside, junction, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolverCaminho("externo/teste.md"), /simbólicos/);
  console.log("✓ Escrita v2: itens, seis tipos, YAML, referências, preservação, revisão concorrente, metadados, fila e bloqueio (bundle fictício, sem API).");
}
