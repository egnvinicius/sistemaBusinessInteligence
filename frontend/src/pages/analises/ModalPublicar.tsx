import { useEffect, useMemo, useState } from 'react';
import {
  CAlert,
  CButton,
  CFormCheck,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react-pro';
import { api, mensagemDeErro } from '../../api/client';
import { useAvisos } from '../../contexts/AvisosContext';
import { useMenu } from '../../contexts/MenuContext';

export interface PainelPublicado {
  id: number;
  nome: string;
  descricao: string | null;
  menuSubgrupoId: number;
  ativo: boolean;
  visibilidade?: 'grupos' | 'subgrupo' | 'privado';
}

interface Local {
  id: number;
  grupo: string;
  caminho: string;
  paineis: number;
}

interface Props {
  analiseId: number;
  nomeAnalise: string;
  painel: PainelPublicado | null;
  /** Há alterações ainda não salvas na análise (o painel mostra a versão salva) */
  alterada: boolean;
  onFechar: () => void;
  onMudou: (p: PainelPublicado | null) => void;
}

/**
 * Publica a análise como painel no menu (qualquer perfil, na própria análise).
 * Locais: os grupos e subgrupos do menu a que a pessoa tem acesso, inclusive os vazios.
 * Público = todos com acesso ao subgrupo; privado = só quem publicou.
 */
export function ModalPublicar({ analiseId, nomeAnalise, painel, alterada, onFechar, onMudou }: Props) {
  const avisar = useAvisos();
  const { recarregarMenu } = useMenu();
  const [locais, setLocais] = useState<Local[] | null>(null);
  const [nome, setNome] = useState(painel?.nome ?? nomeAnalise);
  const [descricao, setDescricao] = useState(painel?.descricao ?? '');
  const [subgrupoId, setSubgrupoId] = useState<number | null>(painel?.menuSubgrupoId ?? null);
  const [visibilidade, setVisibilidade] = useState<'subgrupo' | 'privado'>(painel?.visibilidade === 'subgrupo' ? 'subgrupo' : painel ? 'privado' : 'privado');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .get<Local[]>('/analises/locais-menu')
      .then((r) => {
        setLocais(r.data);
        setSubgrupoId((s) => s ?? r.data[0]?.id ?? null);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const porGrupo = useMemo(() => {
    const m = new Map<string, Local[]>();
    for (const l of locais ?? []) m.set(l.grupo, [...(m.get(l.grupo) ?? []), l]);
    return [...m.entries()];
  }, [locais]);
  const local = locais?.find((l) => l.id === subgrupoId);

  const publicar = async () => {
    if (!subgrupoId) return setErro('Escolha o local no menu.');
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { nome: nome.trim(), descricao: descricao.trim() || null, menuSubgrupoId: subgrupoId, visibilidade, ativo: painel?.ativo ?? true };
      const r = await api.put<PainelPublicado>(`/analises/${analiseId}/publicacao`, corpo);
      await recarregarMenu();
      avisar(painel ? 'Publicação atualizada.' : `Análise publicada como o painel ${corpo.nome}.`);
      onMudou(r.data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const despublicar = async () => {
    setSalvando(true);
    try {
      await api.delete(`/analises/${analiseId}/publicacao`);
      await recarregarMenu();
      avisar('O painel saiu do menu. A análise continua salva.');
      onMudou(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CModal visible onClose={onFechar} alignment="center" size="lg">
      <CModalHeader>
        <CModalTitle>{painel ? 'Publicação no menu' : 'Publicar como painel'}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <p className="small text-body-secondary">
          O painel aparece no menu com os mesmos gráficos e filtros da análise, inclusive tela cheia. Quando você salvar mudanças na análise, o painel muda junto.
        </p>
        {alterada && <CAlert color="warning">Há alterações não salvas nesta análise. O painel mostra a última versão salva.</CAlert>}
        {erro && <CAlert color="danger">{erro}</CAlert>}
        {!locais ? (
          <div className="py-3 text-center">
            <CSpinner color="primary" />
          </div>
        ) : locais.length === 0 ? (
          <p className="mb-0">
            Você ainda não tem acesso a nenhum lugar do menu. Peça a um Gestor para liberar um grupo ou subgrupo do menu para o seu grupo de acesso.
          </p>
        ) : (
          <div className="row g-3">
            <div className="col-md-6">
              <CFormLabel htmlFor="pub-nome">Nome do painel</CFormLabel>
              <CFormInput id="pub-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="col-md-6">
              <CFormLabel htmlFor="pub-local">Local no menu</CFormLabel>
              <CFormSelect id="pub-local" value={subgrupoId ?? ''} onChange={(e) => setSubgrupoId(Number(e.target.value))}>
                {porGrupo.map(([grupo, lista]) => (
                  <optgroup key={grupo} label={grupo}>
                    {lista.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.caminho}
                        {l.paineis === 0 ? ' (vazio)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </CFormSelect>
              <CFormText>Aparecem todos os grupos e subgrupos a que você tem acesso, mesmo sem painéis.</CFormText>
            </div>
            <div className="col-12">
              <CFormLabel htmlFor="pub-desc">Descrição (opcional)</CFormLabel>
              <CFormInput id="pub-desc" value={descricao} maxLength={255} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <fieldset className="col-12">
              <legend className="form-label fs-6 mb-1">Quem vê</legend>
              <CFormCheck
                type="radio"
                name="pub-visibilidade"
                id="pub-privado"
                checked={visibilidade === 'privado'}
                onChange={() => setVisibilidade('privado')}
                label="Privado: só eu"
              />
              <CFormCheck
                type="radio"
                name="pub-visibilidade"
                id="pub-publico"
                checked={visibilidade === 'subgrupo'}
                onChange={() => setVisibilidade('subgrupo')}
                label={`Público: todos com acesso a ${local ? `${local.grupo} › ${local.caminho}` : 'este local do menu'}`}
              />
              <CFormText>Quem vê o painel não precisa ter acesso aos cubos da análise.</CFormText>
            </fieldset>
          </div>
        )}
      </CModalBody>
      <CModalFooter>
        {painel && (
          <CButton color="danger" variant="ghost" className="me-auto" onClick={despublicar} disabled={salvando}>
            Tirar do menu
          </CButton>
        )}
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CLoadingButton color="primary" loading={salvando} disabled={!nome.trim() || !locais?.length} onClick={publicar}>
          {painel ? 'Salvar publicação' : 'Publicar'}
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}
