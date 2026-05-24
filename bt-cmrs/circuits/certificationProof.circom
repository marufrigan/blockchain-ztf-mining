pragma circom 2.0.0;

template CertificationProof() {
    signal input certHash;
    signal input expectedHash;
    certHash === expectedHash;
}

component main { public [expectedHash] } = CertificationProof();
