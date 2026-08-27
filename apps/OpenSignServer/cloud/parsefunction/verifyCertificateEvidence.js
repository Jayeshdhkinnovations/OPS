import {
  checkCrl,
  checkOcsp,
  getCertificateServiceUrls,
  parseDerCertificate,
} from './pdf/ExternalCertificateValidation.js';

export default async function verifyCertificateEvidence(request) {
  const { mode, url, certificateDer, issuerCertificateDer } = request.params || {};
  if (!certificateDer || !issuerCertificateDer || certificateDer.length > 100000) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Bounded certificate DER inputs are required.'
    );
  }
  const certificate = parseDerCertificate(certificateDer);
  const issuerCertificate = parseDerCertificate(issuerCertificateDer);
  try {
    const advertisedUrls = getCertificateServiceUrls(certificate);
    if (!advertisedUrls[mode]?.includes(url)) {
      throw new Error('The requested responder URL is not advertised by the certificate.');
    }
    if (mode === 'ocsp') return await checkOcsp({ url, certificate, issuerCertificate });
    if (mode === 'crl') return await checkCrl({ url, certificate, issuerCertificate });
    throw new Error('Unsupported certificate-status mode.');
  } catch (error) {
    return { status: 'unavailable', source: mode || 'unknown', detail: error.message };
  }
}
