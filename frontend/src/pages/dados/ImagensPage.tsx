import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CFormLabel,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilCloudUpload, cilImage, cilPencil, cilSwapHorizontal, cilTrash } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { useAvisos } from '../../contexts/AvisosContext';
import { recarregarImagens, type ImagemBiblioteca } from '../../components/paineis/SeletorImagem';
import { urlImagem } from '../../components/paineis/Visual';
import { formatarDataHora } from '../../lib/formato';

const ACEITOS = 'image/png,image/jpeg,image/webp,image/gif';

const tamanhoLegivel = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/** Biblioteca de imagens usadas no visual "Imagem/logo" dos painéis e análises. */
export function ImagensPage() {
  const avisar = useAvisos();
  const [imagens, setImagens] = useState<ImagemBiblioteca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);
  const [renomeando, setRenomeando] = useState<ImagemBiblioteca | null>(null);
  const [excluindo, setExcluindo] = useState<ImagemBiblioteca | null>(null);
  // Muda a cada troca de arquivo, para o navegador buscar a imagem nova
  const [versao, setVersao] = useState<Record<number, number>>({});
  const entradaNova = useRef<HTMLInputElement>(null);
  const entradaTroca = useRef<HTMLInputElement>(null);
  const trocando = useRef<ImagemBiblioteca | null>(null);

  const carregar = () =>
    api
      .get<ImagemBiblioteca[]>('/imagens')
      .then((r) => setImagens(r.data))
      .catch((e) => setErro(mensagemDeErro(e)));
  useEffect(() => {
    carregar();
  }, []);

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    const lista = [...arquivos];
    setFalhas([]);
    setEnviando(lista.length);
    const erros: string[] = [];
    for (const arq of lista) {
      const corpo = new FormData();
      corpo.append('arquivo', arq);
      try {
        await api.post('/imagens', corpo);
      } catch (e) {
        erros.push(`${arq.name}: ${mensagemDeErro(e)}`);
      }
      setEnviando((n) => n - 1);
    }
    setFalhas(erros);
    recarregarImagens();
    await carregar();
    const ok = lista.length - erros.length;
    if (ok) avisar(ok === 1 ? 'Imagem incluída.' : `${ok} imagens incluídas.`);
  };

  const trocar = async (arquivos: FileList | null) => {
    const alvo = trocando.current;
    if (!arquivos?.[0] || !alvo) return;
    const corpo = new FormData();
    corpo.append('arquivo', arquivos[0]);
    try {
      await api.post(`/imagens/${alvo.id}/arquivo`, corpo);
      setVersao((v) => ({ ...v, [alvo.id]: Date.now() }));
      recarregarImagens();
      await carregar();
      avisar(`Arquivo de ${alvo.nome} trocado. Os visuais que usam a imagem já mostram a nova.`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  const filtradas = useMemo(() => {
    const b = busca.trim().toLocaleLowerCase('pt-BR');
    return (imagens ?? []).filter((i) => !b || i.nome.toLocaleLowerCase('pt-BR').includes(b));
  }, [imagens, busca]);

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Imagens</h1>
          <p className="pagina-descricao">Logos e figuras para o visual "Imagem/logo" dos painéis e análises. PNG, JPG, WEBP ou GIF; para logos, prefira PNG com fundo transparente.</p>
        </div>
        <CLoadingButton color="primary" loading={enviando > 0} onClick={() => entradaNova.current?.click()}>
          <CIcon icon={cilCloudUpload} className="me-1" />
          Incluir imagens
        </CLoadingButton>
        <input ref={entradaNova} type="file" accept={ACEITOS} multiple hidden onChange={(e) => {
          enviar(e.target.files);
          e.target.value = '';
        }} />
        <input ref={entradaTroca} type="file" accept={ACEITOS} hidden onChange={(e) => {
          trocar(e.target.files);
          e.target.value = '';
        }} />
      </div>
      {erro && (
        <CAlert color="danger" dismissible onClose={() => setErro(null)}>
          {erro}
        </CAlert>
      )}
      {falhas.length > 0 && (
        <CAlert color="warning" dismissible onClose={() => setFalhas([])}>
          <strong>Algumas imagens não foram incluídas:</strong>
          <ul className="mb-0 mt-1">
            {falhas.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </CAlert>
      )}

      {!imagens ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : imagens.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilImage} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma imagem ainda</h2>
            <p>Inclua o logo da empresa, dos clientes ou dos setores para usar nos painéis. Dá para escolher vários arquivos de uma vez; o nome do arquivo vira o nome da imagem.</p>
            <CButton color="primary" className="mt-3" onClick={() => entradaNova.current?.click()}>
              Incluir imagens
            </CButton>
          </CCardBody>
        </CCard>
      ) : (
        <>
          {imagens.length > 8 && (
            <CFormInput className="imagens-busca mb-3" placeholder="Buscar pelo nome" aria-label="Buscar imagens" value={busca} onChange={(e) => setBusca(e.target.value)} />
          )}
          <ul className="imagens-grade">
            {filtradas.map((i) => (
              <li key={i.id} className="imagem-cartao">
                <div className="imagem-miniatura">
                  <img src={`${urlImagem(i.chave)}${versao[i.id] ? `?v=${versao[i.id]}` : ''}`} alt="" loading="lazy" />
                </div>
                <div className="imagem-info">
                  <strong title={i.nome}>{i.nome}</strong>
                  <span>
                    {i.formato.toUpperCase()}
                    {i.largura && i.altura ? ` · ${i.largura}×${i.altura}` : ''} · {tamanhoLegivel(i.tamanho)}
                  </span>
                  <span>{i.usos ? `Usada em ${i.usos} ${i.usos === 1 ? 'visual' : 'visuais'}` : 'Não usada'}</span>
                  <span title={i.criadoPor ? `Incluída por ${i.criadoPor}` : undefined}>Atualizada em {formatarDataHora(i.atualizadoEm)}</span>
                </div>
                <div className="imagem-acoes">
                  <CButton color="secondary" variant="ghost" size="sm" onClick={() => setRenomeando(i)} aria-label={`Renomear ${i.nome}`} title="Renomear">
                    <CIcon icon={cilPencil} />
                  </CButton>
                  <CButton
                    color="secondary"
                    variant="ghost"
                    size="sm"
                    aria-label={`Trocar o arquivo de ${i.nome}`}
                    title="Trocar o arquivo (os visuais que usam a imagem passam a mostrar a nova)"
                    onClick={() => {
                      trocando.current = i;
                      entradaTroca.current?.click();
                    }}
                  >
                    <CIcon icon={cilSwapHorizontal} />
                  </CButton>
                  <CButton color="danger" variant="ghost" size="sm" onClick={() => setExcluindo(i)} aria-label={`Excluir ${i.nome}`} title="Excluir">
                    <CIcon icon={cilTrash} />
                  </CButton>
                </div>
              </li>
            ))}
          </ul>
          {filtradas.length === 0 && <p className="lista-vazia">Nenhuma imagem com esse nome.</p>}
        </>
      )}

      {renomeando && (
        <ModalRenomear
          imagem={renomeando}
          onFechar={() => setRenomeando(null)}
          onSalvo={async () => {
            setRenomeando(null);
            recarregarImagens();
            await carregar();
            avisar('Imagem renomeada.');
          }}
        />
      )}
      {excluindo && (
        <ModalExcluir
          imagem={excluindo}
          onFechar={() => setExcluindo(null)}
          onExcluida={async () => {
            setExcluindo(null);
            recarregarImagens();
            await carregar();
            avisar('Imagem excluída.');
          }}
        />
      )}
    </>
  );
}

function ModalRenomear({ imagem, onFechar, onSalvo }: { imagem: ImagemBiblioteca; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(imagem.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      await api.put(`/imagens/${imagem.id}`, { nome });
      onSalvo();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setSalvando(false);
    }
  };
  return (
    <CModal visible onClose={onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>Renomear imagem</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {erro && <CAlert color="danger">{erro}</CAlert>}
        <CFormLabel htmlFor="img-nome">Nome</CFormLabel>
        <CFormInput id="img-nome" value={nome} maxLength={120} autoFocus onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nome.trim() && salvar()} />
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CLoadingButton color="primary" loading={salvando} disabled={!nome.trim()} onClick={salvar}>
          Salvar
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}

interface Usos {
  paineis: { id: number; nome: string }[];
  analises: { id: number; nome: string; dono: string }[];
}

function ModalExcluir({ imagem, onFechar, onExcluida }: { imagem: ImagemBiblioteca; onFechar: () => void; onExcluida: () => void }) {
  const [usos, setUsos] = useState<Usos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  useEffect(() => {
    api
      .get<Usos>(`/imagens/${imagem.id}/usos`)
      .then((r) => setUsos(r.data))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [imagem.id]);
  const emUso = !!usos && usos.paineis.length + usos.analises.length > 0;
  const excluir = async () => {
    setExcluindo(true);
    try {
      await api.delete(`/imagens/${imagem.id}`);
      onExcluida();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setExcluindo(false);
    }
  };
  return (
    <CModal visible onClose={onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>Excluir {imagem.nome}?</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {erro && <CAlert color="danger">{erro}</CAlert>}
        {!usos ? (
          <CSpinner size="sm" color="primary" />
        ) : emUso ? (
          <>
            <p>A imagem está em uso e não pode ser excluída. Tire-a destes visuais antes:</p>
            <ul className="mb-0">
              {usos.paineis.map((p) => (
                <li key={`p${p.id}`}>Painel {p.nome}</li>
              ))}
              {usos.analises.map((a) => (
                <li key={`a${a.id}`}>
                  Análise {a.nome} (de {a.dono})
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mb-0">A imagem sai da biblioteca e o arquivo é apagado do servidor. Nenhum visual usa esta imagem.</p>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          {emUso ? 'Fechar' : 'Cancelar'}
        </CButton>
        {!emUso && (
          <CLoadingButton color="danger" loading={excluindo} disabled={!usos} onClick={excluir}>
            Excluir imagem
          </CLoadingButton>
        )}
      </CModalFooter>
    </CModal>
  );
}
