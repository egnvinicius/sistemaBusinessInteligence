import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentProps, type ReactElement } from 'react';
import {
  CAlert,
  CButton,
  CButtonGroup,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
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
  CRow,
  CToast,
  CToastBody,
  CToaster,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilCloudUpload, cilTrash } from '@coreui/icons';
import { api, mensagemDeErro } from '../api/client';
import { LoginVisual } from '../components/LoginVisual';
import { useAparencia } from '../contexts/AparenciaContext';
import { useTema } from '../contexts/TemaContext';
import { corValida, hexParaRgb, textoSobre } from '../lib/cores';
import type { Aparencia, Tema } from '../types';
import { FormularioLogin } from './LoginPage';
import { CarregandoTela } from '../layout/Guardas';

type TipoImagem = 'logo' | 'logoEscuro' | 'fundo' | 'favicon';
const NOME_IMAGEM: Record<TipoImagem, string> = { logo: 'Logo do tema claro', logoEscuro: 'Logo do tema escuro', fundo: 'Imagem de fundo', favicon: 'Ícone da aba' };

type CamposEditaveis = Omit<Aparencia, 'logoUrl' | 'logoEscuroUrl' | 'faviconUrl' | 'imagemFundoUrl' | 'atualizadoEm'>;

const extrairCampos = (a: Aparencia): CamposEditaveis => ({
  nomeSistema: a.nomeSistema,
  tituloLogin: a.tituloLogin,
  subtituloLogin: a.subtituloLogin,
  corPrimaria: a.corPrimaria,
  corFundoLogin: a.corFundoLogin,
  corFundoLoginEscuro: a.corFundoLoginEscuro,
  layoutLogin: a.layoutLogin,
  temaPadrao: a.temaPadrao,
});

const LARGURA_PREVIA = 1280;
const ALTURA_PREVIA = 800;

export function AparenciaPage() {
  const { carregada } = useAparencia();
  // Só monta o formulário com a aparência salva já carregada do servidor
  if (!carregada) return <CarregandoTela />;
  return <FormularioAparencia />;
}

function FormularioAparencia() {
  const { aparencia, definirAparencia } = useAparencia();
  const { tema: temaAtual } = useTema();

  const [campos, setCampos] = useState<CamposEditaveis>(() => extrairCampos(aparencia));
  const [temaPrevia, setTemaPrevia] = useState<Tema>(temaAtual);
  const [salvando, setSalvando] = useState(false);
  const [enviandoImagem, setEnviandoImagem] = useState<TipoImagem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false);
  const [toast, setToast] = useState<ReactElement<ComponentProps<typeof CToast>> | undefined>();

  // Se a aparência for recarregada de fora (ex.: restaurar), o formulário acompanha
  const salvo = useMemo(() => extrairCampos(aparencia), [aparencia]);
  const alterado = JSON.stringify(campos) !== JSON.stringify(salvo);
  const coresInvalidas = [campos.corPrimaria, campos.corFundoLogin, campos.corFundoLoginEscuro].some(
    (c) => !corValida(c),
  );

  const previa: Aparencia = { ...aparencia, ...campos };

  const avisar = (texto: string) =>
    setToast(
      <CToast autohide delay={3500} color="success" className="text-white align-items-center">
        <CToastBody>{texto}</CToastBody>
      </CToast>,
    );

  const set = <K extends keyof CamposEditaveis>(chave: K, valor: CamposEditaveis[K]) =>
    setCampos((c) => ({ ...c, [chave]: valor }));

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const { data } = await api.put<Aparencia>('/aparencia', campos);
      definirAparencia(data);
      setCampos(extrairCampos(data));
      avisar('Aparência salva. Os usuários verão as mudanças no próximo acesso.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function enviarImagem(tipo: TipoImagem, e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro(null);
    setEnviandoImagem(tipo);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      const { data } = await api.post<Aparencia>(`/aparencia/imagem/${tipo}`, form);
      // Mantém os campos em edição; só as imagens vêm do servidor
      definirAparencia({ ...data });
      avisar(`${NOME_IMAGEM[tipo]}: atualizado.`);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setEnviandoImagem(null);
    }
  }

  async function removerImagem(tipo: TipoImagem) {
    setErro(null);
    try {
      const { data } = await api.delete<Aparencia>(`/aparencia/imagem/${tipo}`);
      definirAparencia(data);
      avisar(`${NOME_IMAGEM[tipo]}: removido.`);
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }

  async function restaurar() {
    setConfirmarRestaurar(false);
    setErro(null);
    try {
      const { data } = await api.post<Aparencia>('/aparencia/restaurar');
      definirAparencia(data);
      setCampos(extrairCampos(data));
      avisar('Aparência padrão restaurada.');
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }

  return (
    <>
      <CToaster push={toast} placement="top-end" className="p-3" />

      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Aparência</h1>
          <p className="pagina-descricao">Identidade visual da tela de login e do sistema.</p>
        </div>
        <CButton color="secondary" variant="outline" onClick={() => setConfirmarRestaurar(true)}>
          Restaurar padrão
        </CButton>
      </div>

      {erro && (
        <CAlert color="danger" dismissible onClose={() => setErro(null)}>
          {erro}
        </CAlert>
      )}

      <CRow className="g-4">
        <CCol xl={5}>
          <CCard className="mb-4">
            <CCardHeader>Identidade</CCardHeader>
            <CCardBody>
              <div className="mb-3">
                <CFormLabel htmlFor="nome-sistema">Nome do sistema</CFormLabel>
                <CFormInput
                  id="nome-sistema"
                  maxLength={60}
                  value={campos.nomeSistema}
                  onChange={(e) => set('nomeSistema', e.target.value)}
                />
                <CFormText>Aparece na aba do navegador e no menu, quando não há logo.</CFormText>
              </div>
              <CampoImagem
                rotulo="Logo do tema claro"
                url={aparencia.logoUrl}
                enviando={enviandoImagem === 'logo'}
                dica="PNG com fundo transparente. Se só um dos logos for enviado, ele vale para os dois temas. Até 5 MB."
                onEnviar={(e) => enviarImagem('logo', e)}
                onRemover={() => removerImagem('logo')}
              />
              <CampoImagem
                rotulo="Logo do tema escuro"
                url={aparencia.logoEscuroUrl}
                escuro
                enviando={enviandoImagem === 'logoEscuro'}
                dica="Versão clara do logo, para aparecer sobre fundo escuro."
                onEnviar={(e) => enviarImagem('logoEscuro', e)}
                onRemover={() => removerImagem('logoEscuro')}
              />
              <CampoImagem
                rotulo="Ícone da aba do navegador"
                url={aparencia.faviconUrl}
                pequeno
                aceitar="image/png,image/jpeg,image/webp,image/x-icon,.ico"
                enviando={enviandoImagem === 'favicon'}
                dica="Imagem quadrada (ICO ou PNG de 64 × 64 ou 32 × 32). Sem ícone, a aba usa o padrão do sistema."
                onEnviar={(e) => enviarImagem('favicon', e)}
                onRemover={() => removerImagem('favicon')}
              />
            </CCardBody>
          </CCard>

          <CCard className="mb-4">
            <CCardHeader>Tela de login</CCardHeader>
            <CCardBody>
              <div className="mb-3">
                <CFormLabel htmlFor="titulo-login">Título</CFormLabel>
                <CFormInput
                  id="titulo-login"
                  maxLength={80}
                  value={campos.tituloLogin}
                  onChange={(e) => set('tituloLogin', e.target.value)}
                />
              </div>
              <div className="mb-3">
                <CFormLabel htmlFor="subtitulo-login">Texto de apoio</CFormLabel>
                <CFormInput
                  id="subtitulo-login"
                  maxLength={160}
                  value={campos.subtituloLogin}
                  onChange={(e) => set('subtituloLogin', e.target.value)}
                />
              </div>
              <fieldset className="mb-3">
                <legend className="form-label fs-6">Disposição</legend>
                <CFormCheck
                  type="radio"
                  name="layout"
                  id="layout-dividido"
                  label="Dividida: imagem à esquerda, formulário à direita"
                  checked={campos.layoutLogin === 'dividido'}
                  onChange={() => set('layoutLogin', 'dividido')}
                />
                <CFormCheck
                  type="radio"
                  name="layout"
                  id="layout-centralizado"
                  label="Centralizada: formulário num cartão sobre a imagem"
                  checked={campos.layoutLogin === 'centralizado'}
                  onChange={() => set('layoutLogin', 'centralizado')}
                />
              </fieldset>
              <CampoImagem
                rotulo="Imagem de fundo"
                url={aparencia.imagemFundoUrl}
                enviando={enviandoImagem === 'fundo'}
                dica="Sem imagem, a tela usa a ilustração padrão na cor primária. Recomendado: 1920 × 1080, até 5 MB."
                onEnviar={(e) => enviarImagem('fundo', e)}
                onRemover={() => removerImagem('fundo')}
              />
            </CCardBody>
          </CCard>

          <CCard className="mb-4">
            <CCardHeader>Cores e tema</CCardHeader>
            <CCardBody>
              <CampoCor
                id="cor-primaria"
                rotulo="Cor principal"
                dica="Botões, links e destaques em todo o sistema."
                valor={campos.corPrimaria}
                onChange={(v) => set('corPrimaria', v)}
              />
              <CRow>
                <CCol sm={6}>
                  <CampoCor
                    id="cor-fundo-claro"
                    rotulo="Fundo do login (tema claro)"
                    valor={campos.corFundoLogin}
                    onChange={(v) => set('corFundoLogin', v)}
                  />
                </CCol>
                <CCol sm={6}>
                  <CampoCor
                    id="cor-fundo-escuro"
                    rotulo="Fundo do login (tema escuro)"
                    valor={campos.corFundoLoginEscuro}
                    onChange={(v) => set('corFundoLoginEscuro', v)}
                  />
                </CCol>
              </CRow>
              <div>
                <CFormLabel htmlFor="tema-padrao">Tema padrão</CFormLabel>
                <CFormSelect
                  id="tema-padrao"
                  value={campos.temaPadrao}
                  onChange={(e) => set('temaPadrao', e.target.value as CamposEditaveis['temaPadrao'])}
                >
                  <option value="sistema">Seguir o sistema operacional de cada usuário</option>
                  <option value="claro">Claro</option>
                  <option value="escuro">Escuro</option>
                </CFormSelect>
                <CFormText>Vale para quem ainda não escolheu um tema. Cada usuário pode trocar o seu.</CFormText>
              </div>
            </CCardBody>
          </CCard>

          <div className="barra-acoes">
            <CLoadingButton
              color="primary"
              loading={salvando}
              disabled={!alterado || salvando || coresInvalidas}
              onClick={salvar}
            >
              Salvar alterações
            </CLoadingButton>
            <CButton color="secondary" variant="ghost" disabled={!alterado || salvando} onClick={() => setCampos(salvo)}>
              Descartar
            </CButton>
            {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
          </div>
        </CCol>

        <CCol xl={7}>
          <div className="previa-coluna">
            <div className="previa-topo">
              <span className="fw-semibold">Pré-visualização</span>
              <CButtonGroup role="group" aria-label="Tema da pré-visualização" size="sm">
                <CButton
                  color="secondary"
                  variant={temaPrevia === 'claro' ? undefined : 'outline'}
                  onClick={() => setTemaPrevia('claro')}
                >
                  Claro
                </CButton>
                <CButton
                  color="secondary"
                  variant={temaPrevia === 'escuro' ? undefined : 'outline'}
                  onClick={() => setTemaPrevia('escuro')}
                >
                  Escuro
                </CButton>
              </CButtonGroup>
            </div>
            <PreviaLogin aparencia={previa} tema={temaPrevia} />
          </div>
        </CCol>
      </CRow>

      <CModal visible={confirmarRestaurar} onClose={() => setConfirmarRestaurar(false)} alignment="center">
        <CModalHeader>
          <CModalTitle>Restaurar a aparência padrão?</CModalTitle>
        </CModalHeader>
        <CModalBody>Nome, textos e cores voltam ao padrão, e os logos, o ícone da aba e a imagem de fundo são removidos.</CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={() => setConfirmarRestaurar(false)}>
            Cancelar
          </CButton>
          <CButton color="danger" onClick={restaurar}>
            Restaurar padrão
          </CButton>
        </CModalFooter>
      </CModal>
    </>
  );
}

/* ---------- Componentes auxiliares ---------- */

function CampoCor(props: { id: string; rotulo: string; dica?: string; valor: string; onChange: (v: string) => void }) {
  const [texto, setTexto] = useState(props.valor);
  useEffect(() => setTexto(props.valor), [props.valor]);
  const invalido = !corValida(texto);

  return (
    <div className="mb-3">
      <CFormLabel htmlFor={props.id}>{props.rotulo}</CFormLabel>
      <div className="campo-cor">
        <input
          type="color"
          className="campo-cor-amostra"
          value={corValida(props.valor) ? props.valor : '#000000'}
          onChange={(e) => props.onChange(e.target.value.toUpperCase())}
          aria-label={`${props.rotulo}: escolher no seletor`}
        />
        <CFormInput
          id={props.id}
          value={texto}
          maxLength={7}
          invalid={invalido}
          spellCheck={false}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setTexto(v);
            if (corValida(v)) props.onChange(v.toUpperCase());
          }}
          feedbackInvalid="Use o formato #RRGGBB, por exemplo #0B7A75."
        />
      </div>
      {props.dica && <CFormText>{props.dica}</CFormText>}
    </div>
  );
}

function CampoImagem(props: {
  rotulo: string;
  url: string | null;
  /** Miniatura sobre fundo escuro (logo do tema escuro) */
  escuro?: boolean;
  /** Miniatura pequena (ícone da aba) */
  pequeno?: boolean;
  aceitar?: string;
  dica: string;
  enviando: boolean;
  onEnviar: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemover: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mb-3">
      <span className="form-label d-block">{props.rotulo}</span>
      <div className="campo-imagem">
        <div className={`campo-imagem-miniatura${props.escuro ? ' escura' : ''}${props.pequeno ? ' pequena' : ''}`}>
          {props.url ? <img src={props.url} alt="" /> : <span>Nenhuma</span>}
        </div>
        <div className="d-flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={props.aceitar ?? 'image/png,image/jpeg,image/webp'}
            className="d-none"
            onChange={props.onEnviar}
          />
          <CLoadingButton
            color="secondary"
            variant="outline"
            size="sm"
            loading={props.enviando}
            onClick={() => input.current?.click()}
          >
            <CIcon icon={cilCloudUpload} className="me-1" />
            {props.url ? 'Trocar imagem' : 'Enviar imagem'}
          </CLoadingButton>
          {props.url && (
            <CButton color="danger" variant="ghost" size="sm" onClick={props.onRemover}>
              <CIcon icon={cilTrash} className="me-1" />
              Remover
            </CButton>
          )}
        </div>
      </div>
      <CFormText>{props.dica} A imagem é aplicada assim que enviada.</CFormText>
    </div>
  );
}

/** Renderiza a tela de login real em escala, isolada com o tema escolhido. */
function PreviaLogin({ aparencia, tema }: { aparencia: Aparencia; tema: Tema }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);

  useEffect(() => {
    if (!caixa.current) return;
    const obs = new ResizeObserver(([e]) => setEscala(e.contentRect.width / LARGURA_PREVIA));
    obs.observe(caixa.current);
    return () => obs.disconnect();
  }, []);

  const [r, g, b] = hexParaRgb(corValida(aparencia.corPrimaria) ? aparencia.corPrimaria : '#000000');
  const varsPrimaria = {
    '--bi-primary': aparencia.corPrimaria,
    '--bi-primary-rgb': `${r}, ${g}, ${b}`,
    '--bi-on-primary': textoSobre(aparencia.corPrimaria),
    '--cui-primary': aparencia.corPrimaria,
    '--cui-btn-bg': aparencia.corPrimaria,
    '--cui-btn-border-color': aparencia.corPrimaria,
    '--cui-btn-color': textoSobre(aparencia.corPrimaria),
  } as React.CSSProperties;

  return (
    <div ref={caixa} className="previa-caixa" style={{ height: ALTURA_PREVIA * escala }}>
      <div
        className="previa-palco"
        data-coreui-theme={tema === 'escuro' ? 'dark' : 'light'}
        style={{ width: LARGURA_PREVIA, height: ALTURA_PREVIA, transform: `scale(${escala})`, ...varsPrimaria }}
        inert
        aria-hidden="true"
      >
        <LoginVisual aparencia={aparencia} tema={tema} acoes={<span className="previa-tema-icone" />}>
          <FormularioLogin login="" senha="" />
        </LoginVisual>
      </div>
    </div>
  );
}
