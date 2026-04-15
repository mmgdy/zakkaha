import crypto from 'crypto'

export async function POST(request) {
  try {
    const { amount, merchantReference, dateTime } = await request.json()
    const merchantId = process.env.PAYSKY_MERCHANT_ID
    const terminalId = process.env.PAYSKY_TERMINAL_ID
    const secretKey  = process.env.PAYSKY_SECRET_KEY
    if (!merchantId || !terminalId || !secretKey) return Response.json({ error: 'Paysky not configured' }, { status: 500 })

    const params = { Amount: String(amount), DateTimeLocalTrxn: dateTime, MerchantId: merchantId, MerchantReference: merchantReference, TerminalId: terminalId }
    const hashStr = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
    const secureHash = crypto.createHmac('sha256', Buffer.from(secretKey, 'hex')).update(hashStr).digest('hex').toUpperCase()

    return Response.json({ merchantId, terminalId, amount, merchantReference, dateTime, secureHash })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
