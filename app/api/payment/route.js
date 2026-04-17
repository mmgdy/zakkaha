import crypto from 'crypto'

export async function POST(request) {
  try {
    const { amount, merchantReference } = await request.json()
    const merchantId = process.env.PAYSKY_MERCHANT_ID
    const terminalId = process.env.PAYSKY_TERMINAL_ID
    const secretKey  = process.env.PAYSKY_SECRET_KEY
    if (!merchantId || !terminalId || !secretKey) {
      return Response.json({ error: 'Paysky not configured' }, { status: 500 })
    }

    // Paysky docs: TrxDateTime format = "YYYYMMDDHHmm" — 4-digit year, NO seconds
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const dateTime = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`

    // SecureHash per Paysky docs Annex B §5.1:
    // Fields: Amount, DateTimeLocalTrxn, MerchantId, MerchantReference, TerminalId — sorted A-Z
    const hashParams = {
      Amount:            String(amount),
      DateTimeLocalTrxn: dateTime,
      MerchantId:        merchantId,
      MerchantReference: merchantReference,
      TerminalId:        terminalId,
    }
    const hashStr = Object.keys(hashParams).sort().map(k => `${k}=${hashParams[k]}`).join('&')
    const secureHash = crypto
      .createHmac('sha256', Buffer.from(secretKey, 'hex'))
      .update(hashStr)
      .digest('hex')
      .toUpperCase()

    return Response.json({ merchantId, terminalId, amount, merchantReference, dateTime, secureHash })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
