import { useEffect, useState } from 'react';
import { CSpinner } from '@coreui/react-pro';
import { api, mensagemDeErro } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { ehAdmin } from '../../types';
import { urlImagem } from './Visual';

export interface ImagemBiblioteca {
  id: number;
  nome: string;
  chave: string;
  url: string;
  formato: string;
  tamanho: number;
  largura: number | null;
  altura: number | null;
  usos: number;
  criadoPor: string | null;
  atualizadoEm: string;
}

// Lista compartilhada entre os seletores abertos ao mesmo tempo (claro e escuro)
let cache: Promise<ImagemBiblioteca[]> | null = null;
export const recarregarImagens = () => {
  cache = null;
};

interface Props {
  id: string;
  rotulo: string;
  valor: string | null;
  onChange: (chave: string | null) => void;
  /** Texto da opção "nenhuma" (só quando a imagem é opcional) */
  opcaoVazia?: string;
  /** Esconde o atalho para gerenciar (quando outro seletor já mostra) */
  semAtalho?: boolean;
}

/** Escolha de uma imagem da biblioteca, em miniaturas. */
export function SeletorImagem({ id, rotulo, valor, onChange, opcaoVazia, semAtalho }: Props) {
  const { usuario } = useAuth();
  const [imagens, setImagens] = useState<ImagemBiblioteca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!cache) cache = api.get<ImagemBiblioteca[]>('/imagens').then((r) => r.data);
    cache.then(setImagens).catch((e) => {
      cache = null;
      setErro(mensagemDeErro(e));
    });
  }, []);

  return (
    <fieldset className="mb-3">
      <legend className="form-label fs-6">{rotulo}</legend>
      {erro && <p className="text-danger small">{erro}</p>}
      {!imagens && !erro ? (
        <CSpinner size="sm" color="primary" />
      ) : imagens && imagens.length === 0 ? (
        <p className="small text-body-secondary mb-0">
          A biblioteca ainda não tem imagens.{' '}
          {ehAdmin(usuario) ? (
            <a href="/dados/imagens" target="_blank" rel="noreferrer">
              Incluir imagens
            </a>
          ) : (
            'Peça a um Gestor para incluir em Atualização de dados › Imagens.'
          )}
        </p>
      ) : (
        <div className="seletor-imagem" role="radiogroup" aria-label={rotulo} id={id}>
          {opcaoVazia && (
            <button type="button" role="radio" aria-checked={!valor} className={!valor ? 'ativo' : ''} onClick={() => onChange(null)}>
              <span className="seletor-imagem-vazia">{opcaoVazia}</span>
            </button>
          )}
          {imagens?.map((i) => (
            <button
              key={i.chave}
              type="button"
              role="radio"
              aria-checked={valor === i.chave}
              className={valor === i.chave ? 'ativo' : ''}
              onClick={() => onChange(i.chave)}
              title={i.nome}
            >
              <img src={urlImagem(i.chave)} alt="" loading="lazy" />
              <span className="seletor-imagem-nome">{i.nome}</span>
            </button>
          ))}
        </div>
      )}
      {imagens && imagens.length > 0 && ehAdmin(usuario) && !semAtalho && (
        <div className="form-text">
          Falta alguma?{' '}
          <a href="/dados/imagens" target="_blank" rel="noreferrer">
            Gerenciar imagens
          </a>{' '}
          (abre em outra aba; ao voltar, feche e abra este editor para ver as novas).
        </div>
      )}
    </fieldset>
  );
}
