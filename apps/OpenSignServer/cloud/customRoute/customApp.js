import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import docxtopdf, { upload as docxUpload } from './docxtopdf.js';
import decryptpdf, { upload as decryptUpload } from './decryptpdf.js';
import { deleteUserByAdmin, deleteUserPost } from './deleteAccount/deleteUser.js';
import { deleteUserGet } from './deleteAccount/deleteUserGet.js';
import { deleteUserOtp } from './deleteAccount/deleteUserOtp.js';

export const app = express();

dotenv.config({ quiet: true });
app.use(cors());

// /docxtopdf and /decryptpdf are multipart file uploads handled by multer
// below - never by these parsers. Without this exclusion, any request whose
// Content-Type isn't a clean multipart boundary (e.g. a client sending
// "multipart/form-data" without ";boundary=...") falls through to
// express.json() and crashes trying to JSON.parse the raw multipart body.
const isUploadRoute = req => req.path === '/docxtopdf' || req.path === '/decryptpdf';
app.use((req, res, next) => (isUploadRoute(req) ? next() : express.json({ limit: '100mb' })(req, res, next)));
app.use((req, res, next) =>
  isUploadRoute(req) ? next() : express.urlencoded({ limit: '100mb', extended: true })(req, res, next)
);

app.post('/docxtopdf', docxUpload.single('file'), docxtopdf);
app.post('/decryptpdf', decryptUpload.single('file'), decryptpdf);
app.get('/delete-account/:userId', deleteUserGet);
app.post('/delete-account/:userId/otp', deleteUserOtp);
app.post('/delete-account/:userId', deleteUserPost);
app.post('/deleteuser/:userId', deleteUserByAdmin);
