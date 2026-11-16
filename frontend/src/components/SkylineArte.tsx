/**
 * Arte padrão do login quando o administrador não envia imagem de fundo:
 * colunas de "contêineres" empilhados que também são as barras de um gráfico,
 * com uma linha de tendência passando pelo topo. Tudo nos tons da cor primária.
 */
const ALTURAS = [5, 8, 7, 10, 9, 13, 12, 15, 14, 18, 17, 20];
const DESTAQUES = new Set(['2-3', '5-9', '7-6', '9-14', '11-18', '10-2']);

const LARGURA = 38;
const ESPACO = 10;
const BLOCO = 20;
const FOLGA = 4;
const BASE = 560;

export function SkylineArte({ className }: { className?: string }) {
  const largura = ALTURAS.length * (LARGURA + ESPACO) + ESPACO;
  const topo = (col: number) => BASE - ALTURAS[col] * (BLOCO + FOLGA);
  const pontos = ALTURAS.map((_, i) => `${ESPACO + i * (LARGURA + ESPACO) + LARGURA / 2},${topo(i) - 22}`);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${largura} ${BASE + 8}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {ALTURAS.map((altura, col) =>
        Array.from({ length: altura }, (_, nivel) => {
          const x = ESPACO + col * (LARGURA + ESPACO);
          const y = BASE - (nivel + 1) * (BLOCO + FOLGA) + FOLGA;
          const chave = `${col}-${nivel}`;
          return (
            <rect
              key={chave}
              x={x}
              y={y}
              width={LARGURA}
              height={BLOCO}
              rx={2}
              className={DESTAQUES.has(chave) ? 'sk-bloco sk-destaque' : `sk-bloco sk-tom-${(col + nivel) % 3}`}
            />
          );
        }),
      )}
      <polyline className="sk-linha" points={pontos.join(' ')} />
      {pontos.map((p, i) => {
        const [cx, cy] = p.split(',').map(Number);
        return <circle key={i} className="sk-ponto" cx={cx} cy={cy} r={i === pontos.length - 1 ? 5 : 3} />;
      })}
    </svg>
  );
}
