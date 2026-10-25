import { useLayoutEffect, useRef } from 'react';
import { makeAnimCard, afterAnimRender } from '../lib/anim.js';

/** React binding for the source's entrance-animation cards: makeAnimCard() once (it observes the element for the 30% in-view
    trigger), then afterAnimRender() after every commit whose data changed — the same moment the source called it after it
    wrote the card's DOM. The card element's React className must stay constant: the animation toggles 'anim-hold' on it. */
export function useAnimCard(ref, deps, onPlay) {
  const card = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    card.current = makeAnimCard(ref.current, onPlay);
    return () => { if (card.current && card.current.io) card.current.io.disconnect(); card.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => { if (card.current) afterAnimRender(card.current); }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
}
