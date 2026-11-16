import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CAlert, CBreadcrumb, CBreadcrumbItem, CCard, CCardBody, CSpinner } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilLightbulb, cilPencil } from '@coreui/icons';
import { api, AUTOMATICO, mensagemDeErro } from '../../api/client';
import type { ValoresFiltros } from '../../components/paineis/BarraFiltros';
import { TelaPainel, type DefinicaoTela } from '../../components/paineis/TelaPainel';
import type { DadosVisual } from '../../components/paineis/Visual';

interface Definicao extends DefinicaoTela {
  id: number;
  nome: string;
  painelId: number | null;
  doUsuario: boolean;
  donoNome: string | null;
}

/** Análise salva só para ver: sem a parte de montagem, com filtros no topo e tela cheia. */
export function AnaliseVerPage() {
  const { id } = useParams();
  const [def, setDef] = useState<Definicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setDef(null);
    api
      .get<Definicao>(`/analises/${id}/definicao`)
      .then((r) => ativo && setDef(r.data))
      .catch((e) => ativo && setErro(mensagemDeErro(e)));
    return () => {
      ativo = false;
    };
  }, [id]);

  const carregarDados = useCallback(
    async (v: ValoresFiltros, automatico?: boolean) =>
      (await api.post<{ visuais: { id: number; dados?: DadosVisual; erro?: string }[] }>(`/analises/${id}/dados`, { filtros: v }, automatico ? AUTOMATICO : undefined)).data.visuais,
    [id],
  );

  if (erro) {
    return (
      <>
        <CAlert color="danger">{erro}</CAlert>
        <Link to="/analises">Voltar para Minhas análises</Link>
      </>
    );
  }
  if (!def) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  return (
    <TelaPainel
      key={def.id}
      titulo={def.nome}
      descricao={def.doUsuario ? null : `Análise de ${def.donoNome ?? 'outro usuário'} (só para ver)`}
      def={def}
      carregarDados={carregarDados}
      antes={
        <CBreadcrumb className="mb-2">
          <CBreadcrumbItem>
            <Link to="/analises">Minhas análises</Link>
          </CBreadcrumbItem>
          <CBreadcrumbItem active>{def.nome}</CBreadcrumbItem>
        </CBreadcrumb>
      }
      acoes={
        <>
          {def.painelId && (
            <Link to={`/painel/${def.painelId}`} className="btn btn-outline-secondary btn-sm" title="Esta análise também está publicada como painel no menu">
              Ver como painel
            </Link>
          )}
          {def.doUsuario && (
            <Link to={`/analises/${def.id}`} className="btn btn-primary btn-sm">
              <CIcon icon={cilPencil} className="me-1" />
              Editar
            </Link>
          )}
        </>
      }
      vazio={
        <CCard className="estado-vazio mt-3">
          <CCardBody>
            <CIcon icon={cilLightbulb} size="3xl" className="estado-vazio-icone" />
            <h2>Esta análise ainda não tem visuais</h2>
            <p>Use "Editar" para pedir à IA ou montar os gráficos.</p>
          </CCardBody>
        </CCard>
      }
    />
  );
}
