import { createHash, createHmac } from 'node:crypto'

export interface SignRequestInput {
  readonly method: 'POST'
  readonly host: string
  readonly path: string
  readonly region: string
  readonly service: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly accessKey: string
  readonly secretKey: string
  readonly date: Date
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * Plain AWS Signature Version 4 (the PA-API 5 auth scheme), implemented with
 * node:crypto to keep the CLI dependency-free.
 */
export function signRequest(input: SignRequestInput): Record<string, string> {
  const amzDate = input.date.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: input.host,
    'x-amz-date': amzDate,
  }
  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    input.method,
    input.path,
    '', // query string — PA-API uses POST bodies only
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join('\n')

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, input.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
