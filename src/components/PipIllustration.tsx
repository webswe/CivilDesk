import type { PipState } from '../domain/types';

export function PipIllustration({ state, reducedMotion, styleId = 'classic', scarf = false, headphones = false, aura = false }: { state: PipState; reducedMotion: boolean; styleId?: 'classic' | 'berry'; scarf?: boolean; headphones?: boolean; aura?: boolean }) {
  const asleep = state === 'sleeping' || state === 'sleepy';
  const eyes = asleep ? <><path d="M78 105q8 7 16 0M126 105q8 7 16 0"/></> : <><ellipse cx="86" cy="105" rx="4.5" ry="6" fill="#372630"/><ellipse cx="134" cy="105" rx="4.5" ry="6" fill="#372630"/></>;
  return <svg className={`pip-art ${reducedMotion ? 'still' : ''} ${state}`} role="img" aria-label={`Pip is ${state}${scarf ? ' wearing a scarf' : ''}${headphones ? ' and headphones' : ''}`} viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="pipBody" x2="0" y2="1"><stop stopColor={styleId === 'berry' ? '#E5B8D7' : '#F7D9D4'}/><stop offset="1" stopColor={styleId === 'berry' ? '#A46B9B' : '#D99CAD'}/></linearGradient><filter id="pipShadow"><feGaussianBlur stdDeviation="5"/></filter></defs>
    <ellipse cx="110" cy="190" rx="62" ry="12" fill="#160f16" opacity=".27" filter="url(#pipShadow)"/>
    <g className="pip-float"><path d="M62 74Q43 29 62 23Q79 20 89 65M158 74Q177 29 158 23Q141 20 131 65" fill="url(#pipBody)" stroke="#845767" strokeWidth="3"/><path d="M64 38Q63 29 68 34L79 62M156 38Q157 29 152 34L141 62" fill="none" stroke="#B9778D" strokeWidth="5" strokeLinecap="round"/>
    <path d="M47 118C47 71 73 57 110 57S173 71 173 118C173 161 150 181 110 181S47 161 47 118Z" fill="url(#pipBody)" stroke="#845767" strokeWidth="3"/>
    <ellipse cx="68" cy="124" rx="11" ry="7" fill="#D1849B" opacity=".65"/><ellipse cx="152" cy="124" rx="11" ry="7" fill="#D1849B" opacity=".65"/>
    <g stroke="#633D4E" strokeWidth="3" strokeLinecap="round" fill="none">{eyes}<path d={asleep ? 'M105 129q5 4 10 0' : state === 'celebrating' || state === 'happy' || state === 'affectionate' ? 'M99 128q11 13 22 0' : 'M104 129q6 5 12 0'}/></g>
    <path d="M93 122q17-10 34 0" fill="none" stroke="#FFF4E8" strokeWidth="4" opacity=".65"/>
    {headphones && <g fill="none" stroke="#4D4256" strokeWidth="8" strokeLinecap="round"><path d="M58 108Q58 44 110 44Q162 44 162 108"/><path d="M55 100v29M165 100v29" strokeWidth="15"/></g>}
    {scarf && <g><path d="M64 154Q110 171 156 154L153 169Q110 186 67 169Z" fill="#8E4F68" stroke="#E5B8C2" strokeWidth="2"/><path d="M137 166l12 29 12-6-13-30" fill="#8E4F68" stroke="#E5B8C2" strokeWidth="2"/></g>}
    <ellipse cx="63" cy="168" rx="14" ry="8" fill="#D89AA9"/><ellipse cx="157" cy="168" rx="14" ry="8" fill="#D89AA9"/>
    </g>{aura && state === 'celebrating' && <g className="pip-aura" fill="#E5B8C2"><circle cx="30" cy="89" r="4"/><circle cx="188" cy="89" r="4"/><path d="M111 15l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/></g>}{asleep && <text x="171" y="64" fill="#E5B8C2" fontSize="23" fontFamily="sans-serif">z</text>}
  </svg>;
}
