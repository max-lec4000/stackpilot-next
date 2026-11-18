const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.STACKPILOT_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 assert.equal(os.hostname(),'sp-test');
 const base='http://stackpilot.localhost:5173';
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  const admin=JSON.parse(await fs.readFile(os.homedir()+'/.stackpilot-test/admin.json','utf8'));
  await page.goto(base+'/#/verwaltung/remote');
  await page.getByLabel('Benutzername',{exact:true}).fill(admin.username);
  await page.getByLabel('Passwort',{exact:true}).fill(admin.password);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.getByRole('button',{name:'Privaten StackPilot-Zugriff prüfen',exact:true}).click();
  await page.getByRole('link',{name:'StackPilot im Tailnet öffnen',exact:true}).waitFor();
  await page.getByLabel('Tailscale-IP deiner Verwaltungsgeräte',{exact:true}).fill('100.80.0.1');
  await page.getByRole('button',{name:'Passende Zugriffsregel anzeigen',exact:true}).click();
  const json=page.locator('pre').filter({hasText:'tcp:5173'});await json.waitFor();
  const grant=JSON.parse(await json.innerText());assert.deepEqual(grant.ip,['tcp:5173']);assert.deepEqual(grant.src,['100.80.0.1']);
  await page.locator('section.tile').filter({has:page.getByRole('heading',{name:'StackPilot im privaten Tailnet',exact:true})}).screenshot({path:'/tmp/sp-admin-tailnet-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('section.tile').filter({has:page.getByRole('heading',{name:'StackPilot im privaten Tailnet',exact:true})}).screenshot({path:'/tmp/sp-admin-tailnet-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('NATIVE_TAILNET_UI_RULE_AND_MOBILE_CONFIRMED');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
