// Prüft den Freigabe-Schalter je Zuschauer (nur sp-test): schaltet den ersten Zuschauer
// einmal um und wieder zurück, der Ausgangszustand bleibt erhalten.
//   STACKPILOT_PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node scripts/testvm/viewer-requests-ui.cjs
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.STACKPILOT_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 if(os.hostname()!=='sp-test')throw Error('Nur in sp-test ausführen.');
 const base='http://127.0.0.1:5173';
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  const admin=JSON.parse(await fs.readFile(os.homedir()+'/.stackpilot-test/admin.json','utf8'));
  await page.goto(base+'/#/verwaltung/remote');
  await page.getByLabel('Benutzername',{exact:true}).fill(admin.username);
  await page.getByLabel('Passwort',{exact:true}).fill(admin.password);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  const section=page.getByRole('region',{name:'Freigabe für Anfragen'});
  await section.waitFor();
  await section.getByRole('switch').first().waitFor();
  const switches=await section.getByRole('switch').count();
  assert.ok(switches>0);
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({path:'/tmp/sp-viewer-requests.png'});
  console.log(await section.innerText());
  const sw=section.getByRole('switch').first(),item=section.locator('li').first();
  const before=await sw.isChecked();
  await item.locator('label.switch').click();
  await item.getByText(before?'Anfragen laufen ohne Freigabe':'Braucht Freigabe',{exact:true}).waitFor();
  assert.equal(await sw.isChecked(),!before);
  await section.screenshot({path:'/tmp/sp-viewer-requests-toggled.png'});
  await item.locator('label.switch').click();
  await item.getByText(before?'Braucht Freigabe':'Anfragen laufen ohne Freigabe',{exact:true}).waitFor();
  assert.equal(await sw.isChecked(),before);
  assert.deepEqual(errors,[]);
  console.log('VIEWER_REQUESTS_UI_CONFIRMED',switches);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
