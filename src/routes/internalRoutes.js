import express from 'express';
import {
  insertInternalOrgData,
  reportGenerationNode,
} from '../controllers/internalController.js';
import { updateInternalOrgData } from '../controllers/orbisController.js';
import { validateOrg } from '../middlewares/inputValidator.js';
import { getCurrentUser } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/data', getCurrentUser, insertInternalOrgData);
router.post('/updateOrgData', validateOrg, updateInternalOrgData);

// Report Generation with Node.js
router.post('/report-generation-node', reportGenerationNode);

export default router;
