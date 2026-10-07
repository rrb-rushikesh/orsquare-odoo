import { useEffect, useState } from 'react';
import { call, ApiError } from './api';
import { estimateTotal } from './estimate';
export interface CounterQuote { subtotal: number; discount: number; tax: number; total: number; payable: number; lines: any[] }
export function salePayload(v: any) {
  if (Number(v.tip || 0)) throw new ApiError('Service tips are not available yet.', 'not_available');
  if (v.coupon_code && Number(v.quick_discount || 0)) throw new ApiError('Use a coupon or a manual discount, separately.', 'not_available');
  return { client_ref: v.idempotency_key, partner_id: Number(v.customer_id) || undefined,
    lines: v.lines.map((l: any) => ({ product_id: Number(l.product_id), qty: Number(l.qty), price: Number(l.rate) })),
    promo_code: v.coupon_code || undefined,
    bill_discount: Number(v.quick_discount) > 0 ? { kind: 'amount', value: Number(v.quick_discount) } : undefined };
}
export function useCounterQuote(lines: { productId: string; qty: number; rate: number }[], coupon: string, quick: number, customerId?: string) {
  const key = JSON.stringify({ lines, coupon, quick, customerId });
  const [state, setState] = useState<{ key: string; quote: CounterQuote | null; error: string; offline: boolean }>({ key: '', quote: null, error: '', offline: false });
  useEffect(() => {
    let alive = true;
    const input = JSON.parse(key);
    if (!input.lines.length) { setState({ key, quote: { subtotal: 0, discount: 0, tax: 0, total: 0, payable: 0, lines: [] }, error: '', offline: false }); return; }
    const timer = setTimeout(async () => {
      try {
        const quote = await call<CounterQuote>('sales', 'quote', { payload: salePayload({ lines: input.lines.map((l: any) => ({ product_id: l.productId, qty: l.qty, rate: l.rate })), coupon_code: input.coupon, quick_discount: input.quick, customer_id: input.customerId }) });
        if (alive) setState({ key, quote, error: '', offline: false });
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.network && !input.coupon) {
          const total = estimateTotal(input.lines, input.quick ? { kind: 'amount', value: input.quick } : null);
          setState({ key, quote: { subtotal: estimateTotal(input.lines, null), discount: input.quick, tax: 0, total, payable: total, lines: [] }, error: '', offline: true });
        } else setState({ key, quote: null, error: e instanceof Error ? e.message : 'Could not price this bill.', offline: false });
      }
    }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [key]);
  return { ...state, ready: state.key === key && state.quote !== null };
}

export function usePurchaseQuote(lines: { product_id: string; qty: number; rate: number; uom_id?: string }[], supplierId?: string) {
 const key=JSON.stringify({lines,supplier_id:Number(supplierId)||undefined});
 const [state,setState]=useState<{key:string;quote:any;error:string}>({key:'',quote:null,error:''});
 useEffect(()=>{ let alive=true; const input=JSON.parse(key);
   if(!input.lines.length){setState({key,quote:{total:0,lines:[]},error:''});return;}
   const timer=setTimeout(()=>{call<any>('purchases','preview_bill',{payload:input}).then(quote=>{if(alive)setState({key,quote,error:''})}).catch(e=>{if(alive)setState({key,quote:null,error:e.message})});},150);
   return ()=>{alive=false;clearTimeout(timer)};
 },[key]);
 return {...state,ready:state.key===key&&!!state.quote};
}
