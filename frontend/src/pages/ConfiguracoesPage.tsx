import { useEffect, useState } from 'react';
import { CAlert, CCard, CCardBody, CFormCheck, CFormText, CLoadingButton, CSpinner } from '@coreui/react-pro';
import { api, mensagemDeErro } from '../api/client';
import { useAvisos } from '../contexts/AvisosContext';

type Modo = 'variacao' | 'mudancas' | 'ia' | 'desligado';

const OPCOES: { valor: Modo; nome: string; texto: string }[] = [
  { valor: 'variacao', nome: 'Números e variação', texto: 'Os números de cada visual dos painéis que você mais usa, com a variação desde o seu acesso anterior.' },
  { valor: 'mudancas', nome: 'Só o que mudou', texto: 'Mostra apenas os visuais cujo número mudou desde o seu acesso anterior.' },
  {
    valor: 'ia',
    nome: 'Resumo escrito pela IA',
    texto: 'Um texto curto por painel. A IA recebe só os totais e as maiores categorias de cada gráfico, nunca as linhas das tabelas. Gerado uma vez por dia.',
  },
  { valor: 'desligado', nome: 'Desligado', texto: 'A página inicial mostra só os atalhos dos seus painéis.' },
];

/** Configurações pessoais. */
export function ConfiguracoesPage() {
  const avisar = useAvisos();
  const [modo, setModo] = useState<Modo | null>(null);
  const [salvo, setSalvo] = useState<Modo | null>(null);
  const [iaDisponivel, setIaDisponivel] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .get<{ resumoInicio: Modo; iaDisponivel: boolean }>('/inicio/configuracoes')
      .then((r) => {
        setModo(r.data.resumoInicio);
        setSalvo(r.data.resumoInicio);
        setIaDisponivel(r.data.iaDisponivel);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const salvar = async () => {
    if (!modo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.put('/inicio/configuracoes', { resumoInicio: modo });
      setSalvo(modo);
      avisar('Configurações salvas.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <h1 className="pagina-titulo">Configurações</h1>
      <p className="pagina-descricao">Preferências da sua conta.</p>
      {erro && <CAlert color="danger">{erro}</CAlert>}
      <CCard className="configuracoes-card">
        <CCardBody>
          {!modo ? (
            <div className="py-4 text-center">
              <CSpinner color="primary" />
            </div>
          ) : (
            <fieldset>
              <legend className="h5">Resumo na página inicial</legend>
              <p className="small text-body-secondary">Os painéis e análises que você mais abriu nos últimos 60 dias aparecem no Início, com os filtros iniciais de cada um.</p>
              <div className="configuracoes-opcoes">
                {OPCOES.map((o) => (
                  <label key={o.valor} className={`configuracoes-opcao${modo === o.valor ? ' ativa' : ''}`} htmlFor={`resumo-${o.valor}`}>
                    <CFormCheck
                      type="radio"
                      name="resumo"
                      id={`resumo-${o.valor}`}
                      checked={modo === o.valor}
                      disabled={o.valor === 'ia' && !iaDisponivel}
                      onChange={() => setModo(o.valor)}
                    />
                    <span>
                      <strong>{o.nome}</strong>
                      <span className="d-block small text-body-secondary">
                        {o.valor === 'ia' && !iaDisponivel ? 'A IA não está configurada neste servidor.' : o.texto}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="d-flex align-items-center gap-3 mt-3">
                <CLoadingButton color="primary" loading={salvando} disabled={modo === salvo} onClick={salvar}>
                  Salvar
                </CLoadingButton>
                {modo === salvo && <CFormText className="m-0">Nenhuma alteração.</CFormText>}
              </div>
            </fieldset>
          )}
        </CCardBody>
      </CCard>
    </>
  );
}
