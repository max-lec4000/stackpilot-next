import { command } from './inventory.js';
import { bindAddress, hostAllowed, port } from './access.js';
import { buildTailnetGrant, tailnetAddresses } from '../../packages/domain/tailnet-access.js';
export function adminGrant(sources, target) {
  return { ...buildTailnetGrant(sources, target), ip: [`tcp:${port}`] };
}
export class AdminTailnet {
  constructor(run=command, bind=bindAddress()) { this.run=run;this.bind=bind; }
  async inspect(remoteAddress) {
    const [statusResult,prefsResult]=await Promise.all([
      this.run('tailscale',['status','--json']),this.run('tailscale',['debug','prefs']),
    ]);
    let status={},prefs={};
    try{if(statusResult.ok)status=JSON.parse(statusResult.output);}catch{}
    try{if(prefsResult.ok)prefs=JSON.parse(prefsResult.output);}catch{}
    const addresses=tailnetAddresses(status.Self?.TailscaleIPs).filter(a=>!a.includes(':'));
    const dns=status.Self?.DNSName?.replace(/\.$/,'');
    const hostname=typeof dns==='string'&&/^[a-z0-9.-]+\.ts\.net$/.test(dns)&&hostAllowed(dns+':'+port,{bind:this.bind,requiredPort:port})?dns:null;
    const source=String(remoteAddress||'').replace(/^::ffff:/,'');
    const sourceIPs=tailnetAddresses([source]);
    const reachedViaTailnet=sourceIPs.length>0 && !tailnetAddresses(status.Self?.TailscaleIPs).includes(sourceIPs[0]);
    const running=status.BackendState==='Running'&&status.Self?.Online===true;
    const ready=running&&this.bind==='0.0.0.0'&&prefs.ShieldsUp===false&&addresses.length>0;
    return {running,bind:this.bind,incomingAllowed:prefs.ShieldsUp===false,addresses,hostname,
      url:ready?`http://${hostname||addresses[0]}:${port}`:null,
      ipUrl:ready?`http://${addresses[0]}:${port}`:null,
      reachedViaTailnet,
      message:reachedViaTailnet?'Diese Anfrage erreicht StackPilot bereits über das private Tailnet.':
        !running?'Tailscale ist nicht als verbunden bestätigt.':this.bind!=='0.0.0.0'?'StackPilot ist nur am Server selbst gebunden. Den Host-Installer für LAN und Tailnet ausführen.':
        prefs.ShieldsUp===true?'Tailscale blockiert eingehende Verbindungen am Server.':
        !ready?'Serveradressen oder Tailscale-Verbindungsannahme konnten nicht bestätigt werden.':
        'Server ist vorbereitet. Ob ein anderes Gerät TCP 5173 erreichen darf, entscheidet zusätzlich die Tailnet-Regel. Vom gewünschten Gerät aus testen.',
      policyUrl:'https://login.tailscale.com/admin/acls'};
  }
}
