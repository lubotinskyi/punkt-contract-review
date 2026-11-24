const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const path=require('path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const base=process.env.PUNKT_URL||'http://127.0.0.1:8000';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('GigaChat'));
 
 if(process.env.PUNKT_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PUNKT_SCREENSHOTS,'home-desktop.png'),fullPage:true});
 const bootstrap=await (await page.request.get(base+'/api/bootstrap')).json();
 const examples=await page.request.post(base+'/api/examples',{headers:{'X-CSRF-Token':bootstrap.csrf}});
 assert.equal(examples.status(),200);
 const sample=(await examples.json()).selected;
 await page.reload();
 await page.waitForFunction(()=>Boolean(document.querySelector('#contract_id').value));
 await page.selectOption('#mode','demo');
 await page.selectOption('#specification_id',sample.specification);
 await page.selectOption('#supplier_id',sample.suppliers);
 await page.click('#reviewform button[type=submit]');
 await page.waitForFunction(()=>document.querySelectorAll('.finding').length===5,null,{timeout:20000});
 if(await page.locator('#resume').isVisible())throw new Error('Resume should be hidden for completed tasks');
 assert.equal(await page.locator('#reviewbadge').innerText(),'Правила');
 assert.equal(await page.locator('#send').isDisabled(),true);
 assert.equal(await page.locator('#count-findings').innerText(),'5');
 await page.waitForFunction(()=>document.querySelector('#supplier-status').textContent.includes('найден в справочнике'));
 await page.click('#tab-logs');
 assert.equal(await page.locator('#panel-logs').isVisible(),true);
 assert.equal(await page.locator('#logs code').filter({hasText:'check_numbers'}).count(),1);
 await page.click('#tab-rules');
 assert.equal(await page.locator('#panel-rules').isVisible(),true);
 await page.locator('.clause-jump').first().click();
 assert.equal(await page.locator('#tab-findings').getAttribute('aria-selected'),'true');
 const card=page.locator('.finding:focus');
 await card.getByRole('button',{name:/Перейти к/}).click();
 assert.equal(await page.locator('#contracttext .clause.selected').count(),1);
 const first=page.locator('.finding').first();
 await first.locator('.editing summary').click();
 await first.locator('.editing input').fill('Проверенный срок поставки');
 const decisions=page.getByRole('button',{name:'✓ Включить в протокол'});
 for(let i=0;i<await decisions.count();i++)await decisions.nth(i).click();
 assert.equal(await page.locator('#decision-count').innerText(),'Рассмотрено 5 из 5');
 await page.click('#save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Правки сохранены'));
 page.once('dialog',d=>d.accept());await page.click('#approve');await page.waitForFunction(()=>!document.querySelector('#docx').classList.contains('disabled'));
 const downloadResponse=await page.request.get(base+await page.locator('#docx').getAttribute('href'));if(downloadResponse.status()!==200)throw new Error('DOCX export failed');
 await page.click('#send');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('тестовый ящик'));
 // Demo API returns an empty matrix. Exercise populated rendering using real document citations.
 const taskUrl=base+(await page.locator('#docx').getAttribute('href')).replace('/export/docx','');
 await page.route(taskUrl,async route=>{
  const response=await route.fetch();
  const task=await response.json();
  const finding=task.result.findings[0];
  task.result.rule_checks=[{id:'example',status:'соответствует',requirement:'Проверка срока',
   basis:finding.evidence[0],evidence:finding.contract,explanation:'Пункт найден'}];
  await route.fulfill({response,json:task});
 });
 await page.click('#header-history');
 await page.locator('#tasklist').getByRole('button',{name:'Открыть'}).first().click();
 await page.waitForFunction(()=>document.querySelector('#count-rules').textContent==='1');
 await page.click('#tab-rules');
 assert.equal(await page.locator('#rule-checks tbody tr').count(),1);
 assert.match(await page.locator('#review-kpis').innerText(),/1\/1/);
 await page.unroute(taskUrl);
 await page.locator('#tasklist').getByRole('button',{name:'Открыть'}).first().click();
 await page.waitForFunction(()=>document.querySelector('#count-rules').textContent==='0');
 await page.click('#tab-findings');
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  await page.locator('#review').evaluate(report=>report.scrollIntoView());
  if(process.env.PUNKT_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PUNKT_SCREENSHOTS,'review-'+name+'.png')});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2))throw new Error(name+' overflow');
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,findings:5,exportStatus:downloadResponse.status(),browserErrors:errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
