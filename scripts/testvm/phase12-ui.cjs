const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.STACKPILOT_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 if(os.hostname()!=='sp-test')throw Error('Nur in sp-test ausführen.');
 const base='http://127.0.0.1:5173';
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({userAgent:"StackPilot VM Browser Test",viewport:{width:1440,height:1000}});
  const admin=JSON.parse(await fs.readFile(os.homedir()+'/.stackpilot-test/admin.json','utf8'));

  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.goto(base+'/#/verwaltung/profiles');
  await page.getByLabel('Benutzername',{exact:true}).fill(admin.username);
  await page.getByLabel('Passwort',{exact:true}).fill(admin.password);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.getByLabel('Größenstandard',{exact:true}).waitFor().catch(async e=>{await page.screenshot({path:'/tmp/sp-phase12-native-failure.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(0,4000));throw e;});
  assert.equal(await page.getByRole('button',{name:'Medienprofile laden',exact:true}).count(),0);
  await page.screenshot({path:'/tmp/sp-phase12-native-profiles.png',fullPage:true});
  await page.goto(base+'/#/verwaltung/media-files');
  await page.getByRole('heading',{name:'Serienbibliothek bereinigen'}).waitFor();
  await page.getByLabel('Serie',{exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=> (await fetch('/api/media/series-inventory')).status),200);
  assert.equal(await page.evaluate(async()=> (await fetch('/api/media/replacements')).status),200);
  await page.screenshot({path:'/tmp/sp-phase12-native-inventory.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('NATIVE_UPDATED_UI_PROFILES_INVENTORY_REPLACEMENTS_CONFIRMED');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
