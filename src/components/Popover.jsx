import { useEffect } from 'react';
import { installPopoverEngine } from '../lib/popoverEngine.js';

/** The single shared popover node (title, body, Disclaimer, rows, footer, formula, tip, links, arrow) and its scrim. The behaviour
    is the source's engine, installed once the markup exists. */
export function Popover() {
  useEffect(() => { installPopoverEngine(); }, []);
  return (
    <>
      <div className="pop-scrim" id="popScrim" hidden />
      <div className="popover" id="popover" role="dialog" aria-hidden="true" aria-labelledby="popTitle" hidden>
        <button type="button" className="pop-close" id="popClose" aria-label="Close">✕</button>
        <div className="pop-title" id="popTitle" />
        <div className="pop-body" id="popBody" />
        <div className="pop-disc" id="popDisc" hidden><div className="pop-disc-l">Disclaimer</div><div className="pop-disc-b" id="popDiscBody" /></div>
        <div className="pop-rows" id="popRows" />
        <div className="pop-foot" id="popFoot" />
        <div className="pop-formula" id="popFormula" />
        <div className="pop-tip" id="popTip" />
        <div className="pop-links" id="popLinks" hidden />
        <div className="pop-arrow" id="popArrow" />
      </div>
    </>
  );
}
