const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

const MATERIAL_COSTS = { mesh:2.44, standard:1.25, premium:1.75, extra_durable:2.25, double_sided:4.25 };
const SHIPPING_COST  = 10.00;
const TAX_RATES      = { combined:0.09, state:0.04, city:0.035, countyExc:0.01, countyCw:0.005 };

function calcMargin(order) {
  const revenue = parseFloat(order.subtotal)||0;
  const matCost = (order.items||[]).reduce((s,i) => {
    const rate = i.doubleSided ? MATERIAL_COSTS.double_sided : (MATERIAL_COSTS[i.material]||MATERIAL_COSTS.standard);
    return s + rate*(parseFloat(i.sqft)||0)*(parseInt(i.qty)||1);
  }, 0);
  const totalCost   = matCost + SHIPPING_COST;
  const grossProfit = revenue - totalCost;
  return { revenue, matCost, totalCost, grossProfit, marginPct: revenue>0?(grossProfit/revenue)*100:0 };
}

async function getOrders(from, to, tenantId, status) {
  const conditions = ['created_at >= $1','created_at <= $2',"status NOT IN ('pending_payment','cancelled')"]; 
  const params = [from, to]; let i = 3;
  if (tenantId && tenantId !== 'all') { conditions.push(`tenant_id = $${i++}`); params.push(tenantId); }
  const r = await query(`SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY created_at`, params);
  return r.rows;
}

router.get('/summary', async (req, res) => {
  try {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end   = now.toISOString();
    const orders = await getOrders(start, end, null);
    const totals = orders.reduce((s,o) => { const m=calcMargin(o); return { revenue:s.revenue+m.revenue, cost:s.cost+m.totalCost, profit:s.profit+m.grossProfit, tax:s.tax+(parseFloat(o.tax)||0), orders:s.orders+1 }; }, {revenue:0,cost:0,profit:0,tax:0,orders:0});
    res.json({ mtd: { ...totals, marginPct: totals.revenue>0?(totals.profit/totals.revenue)*100:0, month: now.toLocaleString('default',{month:'long',year:'numeric'}) } });
  } catch(err) { res.status(500).json({error:err.message}); }
});

function buildReport(orders, type) {
  const rows = orders.map(o => { const m=calcMargin(o); const c=o.customer||{}; return { orderNumber:o.order_number, date:o.created_at?.split('T')[0], customerName:`${c.firstName||''} ${c.lastName||''}`.trim(), revenue:+m.revenue.toFixed(2), matCost:+m.matCost.toFixed(2), shippingCost:SHIPPING_COST, totalCost:+m.totalCost.toFixed(2), grossProfit:+m.grossProfit.toFixed(2), marginPct:+m.marginPct.toFixed(1), tax:+(parseFloat(o.tax)||0).toFixed(2), status:o.status }; });
  const totals = rows.reduce((s,r)=>({revenue:s.revenue+r.revenue,matCost:s.matCost+r.matCost,shippingCost:s.shippingCost+r.shippingCost,totalCost:s.totalCost+r.totalCost,grossProfit:s.grossProfit+r.grossProfit,tax:s.tax+r.tax}),{revenue:0,matCost:0,shippingCost:0,totalCost:0,grossProfit:0,tax:0});
  return { reportType:type, orderCount:rows.length, ...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,+v.toFixed(2)])), marginPct:+(totals.revenue>0?(totals.grossProfit/totals.revenue)*100:0).toFixed(1), orders:rows };
}

router.get('/daily',   async (req,res)=>{ try { const date=req.query.date||new Date().toISOString().split('T')[0]; const o=await getOrders(date+'T00:00:00Z',date+'T23:59:59Z',req.query.tenant); res.json(buildReport(o,'daily')); }catch(e){res.status(500).json({error:e.message});} });
router.get('/monthly', async (req,res)=>{ try { const now=new Date(); const y=parseInt(req.query.year)||now.getFullYear(); const m=parseInt(req.query.month)||now.getMonth()+1; const from=new Date(y,m-1,1).toISOString(); const to=new Date(y,m,0,23,59,59).toISOString(); const o=await getOrders(from,to,req.query.tenant); res.json({...buildReport(o,'monthly'),year:y,month:m}); }catch(e){res.status(500).json({error:e.message});} });
router.get('/mtd',     async (req,res)=>{ try { const now=new Date(); const from=new Date(now.getFullYear(),now.getMonth(),1).toISOString(); const o=await getOrders(from,now.toISOString(),req.query.tenant); res.json({...buildReport(o,'mtd'),through:now.toISOString().split('T')[0]}); }catch(e){res.status(500).json({error:e.message});} });
router.get('/margin',  async (req,res)=>{ try { const now=new Date(); const from=req.query.from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0]; const to=req.query.to||now.toISOString().split('T')[0]; const o=await getOrders(from+'T00:00:00Z',to+'T23:59:59Z',req.query.tenant); res.json(buildReport(o,'margin')); }catch(e){res.status(500).json({error:e.message});} });

router.get('/tax', async (req,res)=>{ 
  try { 
    const now=new Date(); const y=parseInt(req.query.year)||now.getFullYear(); const m=parseInt(req.query.month)||now.getMonth()+1;
    const from=new Date(y,m-1,1).toISOString(); const to=new Date(y,m,0,23,59,59).toISOString();
    const allOrders=await getOrders(from,to,req.query.tenant);
    const taxOrders=allOrders.filter(o=>{const s=(o.customer?.address?.state||o.shipping_address?.state||'').toUpperCase();return s==='AL'||s==='ALABAMA'||(parseFloat(o.tax)||0)>0;});
    const rows=taxOrders.map(o=>{const sub=parseFloat(o.subtotal)||0;const tax=parseFloat(o.tax)||0;const c=o.customer||{};return{orderNumber:o.order_number,date:o.created_at?.split('T')[0],customerName:`${c.firstName||''} ${c.lastName||''}`.trim(),subtotal:+sub.toFixed(2),taxCollected:+tax.toFixed(2),statePortion:+(tax*(TAX_RATES.state/TAX_RATES.combined)).toFixed(2),cityPortion:+(tax*(TAX_RATES.city/TAX_RATES.combined)).toFixed(2),countyExcPortion:+(tax*(TAX_RATES.countyExc/TAX_RATES.combined)).toFixed(2),countyCwPortion:+(tax*(TAX_RATES.countyCw/TAX_RATES.combined)).toFixed(2)};});
    const totTax=rows.reduce((s,r)=>s+r.taxCollected,0);
    res.json({reportType:'tax',year:y,month:m,rates:{combined:'9.0%',state:'4.0%',city:'3.5%',countyExc:'1.0%',countyCw:'0.5%'},summary:{taxableOrders:rows.length,totalCollected:+totTax.toFixed(2),stateRemittance:+(totTax*(TAX_RATES.state/TAX_RATES.combined)).toFixed(2),cityRemittance:+(totTax*(TAX_RATES.city/TAX_RATES.combined)).toFixed(2),countyExcRemittance:+(totTax*(TAX_RATES.countyExc/TAX_RATES.combined)).toFixed(2),countyCwRemittance:+(totTax*(TAX_RATES.countyCw/TAX_RATES.combined)).toFixed(2)},orders:rows,filingNote:'AL State 4% → Alabama DOR | Madison City 3.5% → City of Madison | County EXC 1% + County-Wide 0.5% → Madison County Revenue. Due by 20th of following month.'});
  }catch(e){res.status(500).json({error:e.message});}
});

module.exports = router;
