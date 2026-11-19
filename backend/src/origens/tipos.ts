import type { TipoParametro, ValorParametro } from '../lib/sqlParametros.js';

/** Dados de uma conexão já com a senha descriptografada (só em memória). */
export interface ConexaoConfig {
  id: number;
  nome: string;
  tipo: string;
  host: string;
  porta: number;
  banco: string;
  usuario: string;
  senha: string;
  criptografar: boolean;
  confiarCertificado: boolean;
  /** Muda quando a conexão é editada; usado para descartar pools antigos. */
  versao: string;
}

export interface ColunaOrigem {
  nome: string;
  /** Tipo informado pela origem, ex.: nvarchar(50), decimal(18,2), datetime. */
  tipoOrigem: string;
}

export interface OpcoesConsulta {
  signal: AbortSignal;
  aoReceberColunas: (colunas: string[]) => Promise<void> | void;
  aoReceberLote: (linhas: unknown[][]) => Promise<void>;
}

/** Contrato de uma fonte de dados. Hoje: SQL Server. Depois: XLS, APIs. */
export interface Origem {
  testar(c: ConexaoConfig): Promise<{ versao: string; banco: string }>;
  /** Colunas que o SELECT retorna, sem executar a consulta. */
  descrever(c: ConexaoConfig, sql: string, params: Record<string, ValorParametro>): Promise<ColunaOrigem[]>;
  /** Calcula uma expressão (ex.: DATEADD(month, -3, GETDATE())) na origem. */
  avaliar(c: ConexaoConfig, expressao: string, tipo: TipoParametro): Promise<unknown>;
  /** Executa o SELECT entregando as linhas em lotes. */
  consultar(c: ConexaoConfig, sql: string, params: Record<string, ValorParametro>, opcoes: OpcoesConsulta): Promise<{ linhas: number }>;
}

/** Servidor inacessível (rede, firewall, servidor desligado): vale tentar de novo. */
export class ErroAcesso extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroAcesso';
  }
}

/** Consulta interrompida pelo tempo máximo ou por um pedido de parada. */
export class ErroInterrompido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroInterrompido';
  }
}

const registro = new Map<string, Origem>();

export function registrarOrigem(tipo: string, origem: Origem) {
  registro.set(tipo, origem);
}

export function origemPara(tipo: string): Origem {
  const o = registro.get(tipo);
  if (!o) throw new Error(`Tipo de conexão não suportado: ${tipo}`);
  return o;
}
