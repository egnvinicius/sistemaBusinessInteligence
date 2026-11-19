const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatarDataHora = (iso: string | null) => (iso ? dataHora.format(new Date(iso)) : 'Nunca');

/** Comparação sem acentos e sem diferenciar maiúsculas, para as buscas das listas. */
export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const contem = (texto: string | null | undefined, busca: string) =>
  !!texto && normalizar(texto).includes(normalizar(busca));

export const plural = (n: number, singular: string, pluralForma: string) =>
  `${n} ${n === 1 ? singular : pluralForma}`;
