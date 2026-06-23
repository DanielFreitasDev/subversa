import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Marca da Subversa — símbolo de versionamento em linha: trunk (verde),
 * branch (roxo) e nós de fluxo (ciano/verde). Reproduz fielmente o ícone
 * oficial do app (`subversa-line-01-system-dark-icon`) como SVG inline,
 * então escala sem perda e dispensa carregar imagem.
 *
 * - `withBackground` (padrão): traz o fundo navy arredondado embutido, igual
 *   ao ícone do app — fica idêntico sobre superfícies claras ou escuras.
 * - `withBackground={false}`: só o símbolo, com os nós em anel (centro
 *   transparente) para assentar sobre qualquer fundo.
 *
 * Os ids de gradiente/filtro são isolados por instância via `useId()` para
 * que múltiplas marcas na mesma tela não colidam.
 */
export function Logo({
  size = 36,
  className,
  withBackground = true,
}: {
  size?: number;
  className?: string;
  withBackground?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const bg = `sv-bg-${uid}`;
  const glow = `sv-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label="Subversa"
      className={className}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#020617" />
          <stop offset="0.5" stopColor="#0B1020" />
          <stop offset="1" stopColor="#24114F" />
        </linearGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#38BDF8" floodOpacity="0.25" />
        </filter>
      </defs>

      <g>
        {withBackground && (
          <rect x="0" y="0" width="256" height="256" rx="58" fill={`url(#${bg})`} />
        )}

        {/* Trilhas: trunk (verde), fluxo (ciano), branch (roxo) */}
        <g filter={`url(#${glow})`} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M128 58 L128 198" stroke="#22C55E" strokeWidth="18" />
          <path d="M128 91 L84 135 L84 166" stroke="#38BDF8" strokeWidth="18" />
          <path d="M128 163 L176 115 L176 88" stroke="#8B5CF6" strokeWidth="18" />
        </g>

        {/* Nós */}
        {withBackground ? (
          <g>
            <Node cx={128} cy={46} fill="#86EFAC" />
            <Node cx={128} cy={210} fill="#22C55E" />
            <Node cx={84} cy={178} fill="#67E8F9" />
            <Node cx={176} cy={76} fill="#A78BFA" />
          </g>
        ) : (
          <g fill="none">
            <Ring cx={128} cy={46} stroke="#86EFAC" />
            <Ring cx={128} cy={210} stroke="#22C55E" />
            <Ring cx={84} cy={178} stroke="#67E8F9" />
            <Ring cx={176} cy={76} stroke="#A78BFA" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** Nó cheio com furo interno (combina com o fundo do ícone). */
function Node({ cx, cy, fill }: { cx: number; cy: number; fill: string }) {
  return (
    <>
      <circle cx={cx} cy={cy} r="25" fill={fill} />
      <circle cx={cx} cy={cy} r="11" fill="#0B1020" />
    </>
  );
}

/** Nó em anel, com centro transparente, para uso sobre qualquer fundo. */
function Ring({ cx, cy, stroke }: { cx: number; cy: number; stroke: string }) {
  return <circle cx={cx} cy={cy} r="18" stroke={stroke} strokeWidth="14" />;
}

/**
 * Assinatura horizontal: marca + "Subversa" e subtítulo. Usada na barra
 * lateral e na tela de Configurações.
 */
export function Wordmark({
  size = 36,
  subtitle = "Cliente SVN",
  className,
}: {
  size?: number;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo size={size} className="shrink-0 rounded-[22%] shadow-soft" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Subversa</div>
        {subtitle && <div className="text-[11px] text-faint">{subtitle}</div>}
      </div>
    </div>
  );
}
