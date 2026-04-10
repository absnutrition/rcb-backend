const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const router  = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const safe = file.originalname.replace(ext,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,40);
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}_${safe}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB)||50)*1024*1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf','.ai','.eps','.png','.jpg','.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

router.post('/artwork', (req, res, next) => {
  upload.array('files', 10)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.length) return res.status(400).json({ error: 'No files received' });

    // If Google Drive is configured, upload there
    const driveEnabled = process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (driveEnabled) {
      const { uploadOrderFiles } = require('../services/drive');
      const orderNumber = req.body.orderNumber || `DRAFT-${Date.now()}`;
      uploadOrderFiles(orderNumber, req.files)
        .then(result => res.json({ success: true, ...result }))
        .catch(err => {
          console.error('[Upload] Drive error:', err.message);
          res.json({ success: true, folderLink: null, files: req.files.map(f => ({ name: f.originalname, localPath: f.path })) });
        });
    } else {
      res.json({ success: true, folderLink: null, files: req.files.map(f => ({ name: f.originalname, size: f.size, localPath: f.path })) });
    }
  });
});

module.exports = router;
