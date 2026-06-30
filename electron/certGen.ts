import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

export function generateCert(keyPath: string, certPath: string): void {
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=SunSaltyBoard"`,
      { stdio: 'ignore' },
    )
  } catch {
    const { generateKeyPairSync } = require('crypto') as typeof import('crypto')
    const { keys } = { keys: require('crypto').generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })}

    writeFileSync(keyPath, keys.privateKey)
    writeFileSync(certPath, keys.publicKey)
  }
}
