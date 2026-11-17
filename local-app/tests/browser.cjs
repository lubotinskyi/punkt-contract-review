const {chromium}=require('playwright');
const path=require('path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('GigaChat'));
 
 await page.screenshot({path:path.join(__dirname,'../reports/home-desktop.png'),fullPage:true});
 await page.click('#examples');await page.waitForFunction(()=>document.querySelector('#mode').value==='demo');
 await page.click('#reviewform button[type=submit]');
 await page.waitForFunction(()=>document.querySelectorAll('.finding').length===5,{timeout:20000});
 if(await page.locator('#resume').isVisible())throw new Error('Resume should be hidden for completed tasks');
 const title=await page.locator('#reviewbadge').innerText();if(!title.includes('БЕЗ LLM'))throw new Error('Demo is not labelled');
 const selects=page.locator('.finding > select:last-child');for(let i=0;i<await selects.count();i++)await selects.nth(i).selectOption('accepted');
 await page.click('#save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Правки сохранены'));
 page.once('dialog',d=>d.accept());await page.click('#approve');await page.waitForFunction(()=>!document.querySelector('#docx').classList.contains('disabled'));
 const downloadResponse=await page.request.get('http://127.0.0.1:8000'+await page.locator('#docx').getAttribute('href'));if(downloadResponse.status()!==200)throw new Error('DOCX export failed');
 await page.click('#send');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('тестовый ящик'));
 await page.screenshot({path:path.join(__dirname,'../reports/review-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(__dirname,'../reports/review-mobile.png'),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2))throw new Error('Mobile overflow');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,findings:5,exportStatus:downloadResponse.status(),browserErrors:errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
