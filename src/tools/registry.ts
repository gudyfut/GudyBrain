import { hora } from "./hora";
import { memoriaListar } from "./memoria/listar";
import { memoriaBuscar } from "./memoria/buscar";
import { memoriaLer } from "./memoria/ler";
import { memoriaTemplate } from "./memoria/template";
import { memoriaPrepararCandidato } from "./memoria/candidato";
import { memoriaFinalizarCobertura } from "./memoria/cobertura";
import { memoriaContextualizar } from "./memoria/contextualizar";
import { memoriaClassificarNovidade } from "./memoria/contextualizacao";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export const toolHandlers: Record<string, ToolHandler> = {
  hora,
  memoria_listar: memoriaListar,
  memoria_buscar: memoriaBuscar,
  memoria_ler: memoriaLer,
  memoria_template: memoriaTemplate,
  memoria_preparar_candidato: memoriaPrepararCandidato,
  memoria_finalizar_cobertura: memoriaFinalizarCobertura,
  memoria_contextualizar: memoriaContextualizar,
  memoria_classificar_novidade: memoriaClassificarNovidade,
};
