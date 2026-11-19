import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CBreadcrumb, CBreadcrumbItem, CCard, CCardBody, CSpinner } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilBan, cilBarChart, cilPencil } from '@coreui/icons';
import { api, AUTOMATICO, mensagemDeErro } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { ValoresFiltros } from '../components/paineis/BarraFiltros';
import { TelaPainel, type DefinicaoTela } from '../components/paineis/TelaPainel';
import type { DadosVisual } from '../components/paineis/Visual';
import { ehAdmin, type PainelDetalhe } from '../types';

interface Definicao extends DefinicaoTela {
  id: number;
  nome: string;
  descricao: string | null;
  /** Painel publicado a partir de uma análise */
  analiseId: number | null;
  analiseDoUsuario?: boolean;
}

export function PainelPage() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [painel, setPainel] = useState<PainelDetalhe | null>(null);
  const [def, setDef] = useState<Definicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setPainel(null);
    setDef(null);
    setErro(null);
    Promise.all([api.get<PainelDetalhe>(`/menu/paineis/${id}`), api.get<Definicao>(`/paineis/${id}/definicao`)])
      .then(([p, d]) => {
        if (!ativo) return;
        setPainel(p.data);
        setDef(d.data);
      })
      .catch((e) => ativo && setErro(mensagemDeErro(e)));
    return () => {
      ativo = false;
    };
  }, [id]);

  const carregarDados = useCallback(
    async (v: ValoresFiltros, automatico?: boolean) =>
      (await api.post<{ visuais: { id: number; dados?: DadosVisual; erro?: string }[] }>(`/paineis/${id}/dados`, { filtros: v }, automatico ? AUTOMATICO : undefined)).data.visuais,
    [id],
  );

  if (erro) {
    return (
      <CCard className="estado-vazio">
        <CCardBody>
          <CIcon icon={cilBan} size="3xl" className="estado-vazio-icone" />
          <h2>Painel indisponível</h2>
          <p>{erro}</p>
          <p className="mt-3">
            <Link to="/">Voltar ao início</Link>
          </p>
        </CCardBody>
      </CCard>
    );
  }

  if (!painel || !def) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  const deAnalise = !!def.analiseId;

  return (
    <TelaPainel
      key={def.id}
      titulo={painel.nome}
      descricao={painel.descricao}
      def={def}
      carregarDados={carregarDados}
      antes={
        <CBreadcrumb className="mb-2">
          <CBreadcrumbItem>{painel.grupo.nome}</CBreadcrumbItem>
          {painel.caminho.map((c) => (
            <CBreadcrumbItem key={c.id}>{c.nome}</CBreadcrumbItem>
          ))}
        </CBreadcrumb>
      }
      acoes={
        deAnalise ? (
          def.analiseDoUsuario && (
            <Link to={`/analises/${def.analiseId}`} className="btn btn-outline-secondary btn-sm">
              <CIcon icon={cilPencil} className="me-1" />
              Editar análise
            </Link>
          )
        ) : (
          ehAdmin(usuario) && (
            <Link to={`/admin/paineis/${def.id}/montar`} className="btn btn-outline-secondary btn-sm">
              <CIcon icon={cilPencil} className="me-1" />
              Montar painel
            </Link>
          )
        )
      }
      vazio={
        <CCard className="estado-vazio mt-3">
          <CCardBody>
            <CIcon icon={cilBarChart} size="3xl" className="estado-vazio-icone" />
            <h2>Este painel ainda não tem gráficos</h2>
            <p>
              {deAnalise
                ? 'A análise publicada neste painel ainda não tem visuais.'
                : ehAdmin(usuario)
                  ? 'Use "Montar painel" para escolher os indicadores, gráficos e filtros.'
                  : 'Os gráficos e indicadores são adicionados por um administrador e aparecem aqui assim que forem publicados.'}
            </p>
          </CCardBody>
        </CCard>
      }
    />
  );
}
