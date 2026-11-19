import type { CSSProperties } from 'react';
import { Visual, type DadosVisual, type DefinicaoVisual } from './Visual';

export const ALTURA_LINHA = 64;
export const ESPACO = 16;

export interface ItemGrade {
  chave: string;
  layout: { x: number; y: number; w: number; h: number };
  visual: DefinicaoVisual & { dados?: DadosVisual; erro?: string | null };
}

/**
 * Grade de 12 colunas do painel (mesma geometria do montador).
 * Em telas estreitas os visuais ficam um embaixo do outro, na ordem da grade.
 */
export function GradeVisuais({ itens }: { itens: ItemGrade[] }) {
  const ordenados = [...itens].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  return (
    <div className="grade-painel" style={{ '--altura-linha': `${ALTURA_LINHA}px`, '--espaco': `${ESPACO}px` } as CSSProperties}>
      {ordenados.map((i) => (
        <div
          key={i.chave}
          className="grade-item"
          style={
            {
              gridColumn: `${i.layout.x + 1} / span ${i.layout.w}`,
              gridRow: `${i.layout.y + 1} / span ${i.layout.h}`,
              '--h': i.layout.h,
            } as CSSProperties
          }
        >
          <Visual {...i.visual} />
        </div>
      ))}
    </div>
  );
}
