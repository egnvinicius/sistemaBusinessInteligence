export type Tema = 'claro' | 'escuro';

export type Perfil = 'usuario' | 'gestor' | 'desenvolvedor';

export const NOME_PERFIL: Record<Perfil, string> = {
  usuario: 'Usuário',
  gestor: 'Gestor',
  desenvolvedor: 'Desenvolvedor',
};

/** Gestor e Desenvolvedor veem todos os painéis e acessam a administração. */
export const ehAdmin = (u?: { perfil: Perfil } | null) => !!u && u.perfil !== 'usuario';
export const ehDesenvolvedor = (u?: { perfil: Perfil } | null) => u?.perfil === 'desenvolvedor';

export interface Usuario {
  id: number;
  nome: string;
  email: string | null;
  login: string;
  perfil: Perfil;
  temaPreferido: Tema | null;
  trocaSenhaObrigatoria: boolean;
  emailPendente: boolean;
  /** Política de sessão: termina à meia-noite e/ou após X horas sem uso; nada marcado = não expira */
  sessao?: { meiaNoite: boolean; inatividadeHoras: number | null };
}

export interface SessaoResposta {
  accessToken: string;
  usuario: Usuario;
  /** Até quando a sessão vale, se não houver uso antes (ISO) */
  expiraEm?: string;
}

export interface Aparencia {
  nomeSistema: string;
  tituloLogin: string;
  subtituloLogin: string;
  corPrimaria: string;
  corFundoLogin: string;
  corFundoLoginEscuro: string;
  layoutLogin: 'dividido' | 'centralizado';
  logoUrl: string | null;
  /** Logo para o tema escuro; sem ele, usa o logo normal (e vice-versa) */
  logoEscuroUrl: string | null;
  /** Ícone da aba do navegador */
  faviconUrl: string | null;
  imagemFundoUrl: string | null;
  temaPadrao: 'claro' | 'escuro' | 'sistema';
  atualizadoEm?: string;
}

/** Logo do tema atual; se só um dos dois foi enviado, ele vale para ambos. */
export const logoDoTema = (a: Pick<Aparencia, 'logoUrl' | 'logoEscuroUrl'>, tema: Tema) =>
  tema === 'escuro' ? (a.logoEscuroUrl ?? a.logoUrl) : (a.logoUrl ?? a.logoEscuroUrl);

export const APARENCIA_PADRAO: Aparencia = {
  nomeSistema: 'Plataforma BI',
  tituloLogin: 'Bem-vindo',
  subtituloLogin: 'Acesse seus painéis de indicadores',
  corPrimaria: '#0B7A75',
  corFundoLogin: '#F2F5F4',
  corFundoLoginEscuro: '#0D1719',
  layoutLogin: 'dividido',
  logoUrl: null,
  logoEscuroUrl: null,
  faviconUrl: null,
  imagemFundoUrl: null,
  temaPadrao: 'sistema',
};

/* ---------- Fase 2: usuários, grupos e menu ---------- */

export interface GrupoResumo {
  id: number;
  nome: string;
}

export interface UsuarioAdmin {
  id: number;
  nome: string;
  login: string;
  email: string | null;
  perfil: Perfil;
  ativo: boolean;
  bloqueado: boolean;
  trocaSenhaObrigatoria: boolean;
  ultimoAcesso: string | null;
  grupos: GrupoResumo[];
  sessaoMeiaNoite: boolean;
  sessaoInatividadeHoras: number | null;
}

export interface GrupoAcesso {
  id: number;
  nome: string;
  descricao: string | null;
  membros: number[];
  paineis: number[];
}

/** Menu que o usuário enxerga (já filtrado por permissão). Subgrupos podem ter subgrupos. */
export interface MenuSubgrupo {
  id: number;
  nome: string;
  subgrupos: MenuSubgrupo[];
  paineis: { id: number; nome: string }[];
}
export interface MenuGrupo {
  id: number;
  nome: string;
  icone: string | null;
  subgrupos: MenuSubgrupo[];
}

/** Árvore completa para administração. */
export interface ArvoreGrupo {
  id: number;
  nome: string;
  icone: string | null;
  /** Grupos de acesso liberados no grupo do menu (valem para todos os subgrupos dele) */
  grupos?: number[];
  subgrupos: ArvoreSubgrupo[];
}
export interface ArvoreSubgrupo {
  id: number;
  nome: string;
  /** 1 = logo abaixo do grupo; máximo 3. */
  nivel: number;
  /** Grupos de acesso liberados no subgrupo (valem para os subgrupos de dentro) */
  grupos?: number[];
  subgrupos: ArvoreSubgrupo[];
  paineis: ArvorePainel[];
}

export const MAX_NIVEIS_SUBGRUPO = 3;
export interface ArvorePainel {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  grupos: number[];
  /** Painel que mostra uma análise publicada (os gráficos vêm da análise) */
  analiseId?: number | null;
  /** grupos = por grupos de acesso; subgrupo = público no subgrupo; privado = só o dono */
  visibilidade?: 'grupos' | 'subgrupo' | 'privado';
  donoNome?: string | null;
}

export interface PainelDetalhe {
  id: number;
  nome: string;
  descricao: string | null;
  grupo: GrupoResumo;
  caminho: GrupoResumo[];
}

/* ---------- Fase 3: conexões, ações e tarefas ---------- */

export interface Conexao {
  id: number;
  nome: string;
  tipo: 'sqlserver';
  host: string;
  porta: number;
  banco: string;
  usuario: string;
  criptografar: boolean;
  confiarCertificado: boolean;
  ativo: boolean;
  ultimoTeste: { em: string; ok: boolean; mensagem: string } | null;
  acoes: number;
}

export interface AcaoResumo {
  id: number;
  nome: string;
  tipo: 'integracao';
  conexao: GrupoResumo;
  tabelaDestino: string;
  tempoMaximoMin: number;
  ativo: boolean;
  tarefas: GrupoResumo[];
  atualizadoEm: string;
  resumoSql?: string;
  temLimpeza?: boolean;
}

export interface Acao extends AcaoResumo {
  comandoSql: string;
  comandoLimpeza: string | null;
  parametrosConvertidos?: number;
}

export interface ValidacaoAcao {
  tabela: string;
  tabelaExiste: boolean;
  colunasOrigem: { nome: string; tipoOrigem: string; tipoDestino: string }[];
  colunasTabela: { nome: string; tipo: string }[];
  faltamNaTabela: string[];
  faltamNoSelect: string[];
  parametrosSelect: string[];
  parametrosLimpeza: string[];
  erroOrigem: string | null;
}

export type SituacaoExecucao =
  | 'na_fila'
  | 'executando'
  | 'concluido'
  | 'concluido_com_erros'
  | 'erro'
  | 'cancelado'
  | 'ignorado'
  | 'nao_executada';

export interface TarefaResumo {
  id: number;
  nome: string;
  descricao: string | null;
  ativa: boolean;
  grupo: GrupoResumo;
  acoes: number;
  agendas: number;
  ultima: { id: number; situacao: SituacaoExecucao; inicio: string | null; fim: string | null; criado_em: string; mensagem: string | null } | null;
  andamento: { id: number; situacao: SituacaoExecucao; inicio: string | null; criado_em: string } | null;
  proxima: string | null;
}

export interface Agenda {
  id: number;
  repetirPor: 'semana' | 'mes';
  diasSemana: number[];
  diasMes: number[];
  meses: number[];
  horas: number[];
  minutos: number[];
  ativa: boolean;
}

export interface ParametroTarefa {
  id: number;
  agendaId: number | null;
  nome: string;
  tipo: 'texto' | 'numero' | 'data';
  modo: 'fixo' | 'expressao';
  valor: string;
}

export interface TarefaDetalhe {
  id: number;
  nome: string;
  descricao: string | null;
  ativa: boolean;
  grupo: GrupoResumo;
  maxTentativasAcesso: number;
  janelaTentativasMin: number;
  proxima: string | null;
  acoes: {
    acaoId: number;
    nome: string;
    ativo: boolean;
    ordem: number;
    casoErro: 'continuar' | 'parar';
    tentativas: number;
    tabelaDestino: string;
    tempoMaximoMin: number;
    conexao: string;
  }[];
  agendas: Agenda[];
  parametros: ParametroTarefa[];
  parametrosVisiveis: boolean;
}

export interface Execucao {
  id: number;
  tarefaId: number;
  tarefaNome?: string;
  origem: 'agenda' | 'manual' | 'recuperacao';
  situacao: SituacaoExecucao;
  agendadoPara: string | null;
  inicio: string | null;
  fim: string | null;
  criadoEm: string;
  mensagem: string | null;
  parametros: Record<string, string> | null;
  solicitadoPor: string | null;
  acoesTotal?: number;
  acoesErro?: number;
}

export interface ExecucaoDetalhe extends Execucao {
  acoes: {
    nome: string;
    ordem: number;
    situacao: 'pendente' | 'executando' | 'concluido' | 'erro' | 'cancelado' | 'pulado';
    tentativas: number;
    linhasExcluidas: number | null;
    linhasInseridas: number | null;
    inicio: string | null;
    fim: string | null;
    mensagem: string | null;
  }[];
  logs: { nivel: 'info' | 'aviso' | 'erro'; mensagem: string; dataHora: string }[];
}
