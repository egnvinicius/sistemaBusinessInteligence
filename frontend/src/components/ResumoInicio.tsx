import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CAlert, CButton, CSpinner } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilArrowBottom, cilArrowTop, cilReload, cilSettings } from '@coreui/icons';
import { api, mensagemDeErro } from '../api/client';
import { formatarCurto, type Formato } from '../lib/graficos';

interface Metrica {
  chave: string;
  titulo: string;
  tipo: string;
  formato: Formato;
  valor: number | null;
  anterior: number | null;
  desde: string | null;
  detalhe: string | null;
  erro?: string;
}
interface Item {
  tipo: 'painel' | 'analise';
  id: number;
  nome: string;
  link: string;
  acessos: number;
  visuais: Metrica[];
  texto?: string | null;
}
interface Resumo {
  modo: 'variacao' | 'mudancas' | 'ia' | 'desligado';
  itens: Item[];
  totalItens?: number;
  geradoEm?: string | null;
  aviso?: string | null;
  detalhe?: string | null;
}

const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, signDisplay: 'always' });

/** Variação desde o acesso anterior: seta + percentual (ou a diferença, quando o anterior era zero). */
function Variacao({ m }: { m: Metrica }) {
  if (m.erro) return <span className="resumo-var erro">{m.erro}</span>;
  if (m.anterior === null || m.valor === null) return <span className="resumo-var neutra">primeiro registro</span>;
  const dif = m.valor - m.anterior;
  const desde = m.desde ? ` desde ${dia.format(new Date(m.desde))}` : '';
  if (Math.abs(dif) < 1e-9) return <span className="resumo-var neutra">sem mudança{desde}</span>;
  const texto = m.anterior !== 0 ? `${pct.format((dif / Math.abs(m.anterior)) * 100)}%` : `${dif > 0 ? '+' : ''}${formatarCurto(dif, m.formato)}`;
  return (
    <span className={`resumo-var ${dif > 0 ? 'sobe' : 'desce'}`}>
      <CIcon icon={dif > 0 ? cilArrowTop : cilArrowBottom} size="sm" />
      <span className="visually-hidden">{dif > 0 ? 'subiu' : 'caiu'}</span> {texto}
      <span className="resumo-var-desde">{desde}</span>
    </span>
  );
}

/** Resumo dos painéis mais usados, no modo escolhido em Configurações. */
export function ResumoInicio({ ocultarVazio = false }: { ocultarVazio?: boolean }) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async (atualizar = false) => {
    setAtualizando(true);
    try {
      setResumo((await api.get<Resumo>('/inicio/resumo', { params: atualizar ? { atualizar: '1' } : {} })).data);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (resumo?.modo === 'desligado') return null;
  // Sem painéis no menu e sem nada para resumir: a página já mostra o aviso de "nenhum painel"
  if (ocultarVazio && (!resumo || (resumo.itens.length === 0 && !resumo.totalItens))) return null;

  return (
    <section className="resumo-inicio" aria-labelledby="resumo-titulo">
      <div className="resumo-cabecalho">
        <h2 id="resumo-titulo">{resumo?.modo === 'mudancas' ? 'O que mudou nos seus painéis' : 'Resumo dos seus painéis'}</h2>
        <div className="d-flex align-items-center gap-2">
          {resumo?.modo === 'ia' && resumo.geradoEm && <span className="resumo-gerado">Resumo da IA das {hora.format(new Date(resumo.geradoEm))}</span>}
          <CButton
            color="secondary"
            variant="ghost"
            size="sm"
            disabled={atualizando}
            onClick={() => carregar(resumo?.modo === 'ia')}
            title={resumo?.modo === 'ia' ? 'Gerar o resumo de novo (conta no limite diário da IA)' : 'Atualizar os números'}
          >
            {atualizando ? <CSpinner size="sm" /> : <CIcon icon={cilReload} />}
            <span className="visually-hidden">Atualizar</span>
          </CButton>
          <Link to="/configuracoes" className="btn btn-sm btn-ghost-secondary" title="Escolher o tipo de resumo ou desligar">
            <CIcon icon={cilSettings} className="me-1" />
            Configurar
          </Link>
        </div>
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}
      {resumo?.aviso && (
        <CAlert color="warning" className="py-2 small">
          {resumo.aviso}
          {resumo.detalhe && (
            <span className="d-block mt-1">
              Resposta do serviço: <code className="erro-ia-detalhe">{resumo.detalhe}</code>
            </span>
          )}
        </CAlert>
      )}
      {!resumo && !erro ? (
        <div className="py-4 text-center">
          <CSpinner color="primary" />
        </div>
      ) : resumo && resumo.itens.length === 0 ? (
        <p className="resumo-vazio">
          {resumo.modo === 'mudancas' && resumo.totalItens
            ? 'Nada mudou desde o seu acesso anterior nos painéis que você mais usa.'
            : 'Abra alguns painéis ou análises: os que você mais usa aparecem aqui com os números do dia.'}
        </p>
      ) : (
        <div className="resumo-itens">
          {resumo?.itens.map((it) => (
            <article key={`${it.tipo}-${it.id}`} className="resumo-item">
              <h3>
                {it.link ? <Link to={it.link}>{it.nome}</Link> : it.nome}
                <span className="resumo-item-tipo">{it.tipo === 'painel' ? 'Painel' : 'Análise'}</span>
              </h3>
              {it.texto && <p className="resumo-texto">{it.texto}</p>}
              <ul className={`resumo-visuais${it.texto ? ' compacto' : ''}`}>
                {it.visuais.map((m) => (
                  <li key={m.chave}>
                    <span className="resumo-visual-titulo">{m.titulo}</span>
                    {!m.erro && <span className="resumo-valor">{formatarCurto(m.valor, m.formato)}</span>}
                    <Variacao m={m} />
                    {m.detalhe && !it.texto && <span className="resumo-detalhe">{m.detalhe}</span>}
                  </li>
                ))}
                {it.visuais.length === 0 && <li className="resumo-detalhe">Sem indicadores ou gráficos para resumir.</li>}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
