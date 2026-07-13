import Joi from "joi";

const orgScheme = Joi.object({
  orgName: Joi.string().min(3).required(),
  orgIdentifier: Joi.string().min(3).required(),
});

const gridScheme = Joi.object({
  orgName: Joi.string().min(3).required(),
  sessionId: Joi.string().min(3).required(),
  ensId: Joi.string().min(3).required(),
  city: Joi.string().min(3),
  bvdId: Joi.string().min(3).required(),
  country: Joi.string().min(2).required()
});

const idScheme = Joi.object({
  sessionId: Joi.string().min(3).required(),
  ensId: Joi.string().min(3).required(),
  bvdId: Joi.string().min(3).required(),
});

const gridPersonnelScheme = Joi.object({
  personnelName: Joi.string().min(3).required(),
  sessionId: Joi.string().min(3).required(),
  ensId: Joi.string().min(3).required(),
  contactId: Joi.string().min(3).required(),
  city: Joi.string().min(3),
  country: Joi.string().min(2),
  managementInfo: Joi.object()
});




export const validateOrg = (req, res, next) => {
  const { error } = orgScheme.validate(req.body);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};


const truesightRequestSchema = Joi.object({
  orgName: Joi.string().min(3).required(),
  orgCountry: Joi.string().min(1).required(),
  sessionId: Joi.string().min(3).required(),
  ensId: Joi.string().min(3).required(),
  nationalId: Joi.string().min(3).required(),
  state: Joi.string(),
  city: Joi.string().min(3),
  address: Joi.string().min(3),
  postCode: Joi.string().min(3),
  emailOrWebsite: Joi.string().min(3),
  phoneOrFax: Joi.string().min(3)
});

const truesightRequestSchema1 = Joi.object({
  orgName: Joi.string().min(3),
  orgCountry: Joi.string().min(1),
  sessionId: Joi.string().min(3).required(),
  ensId: Joi.string().min(3).required(),
  nationalId: Joi.string().min(3).required(),
  state: Joi.string(),
  city: Joi.string().min(3),
  address: Joi.string().min(3),
  postCode: Joi.string().min(3),
  emailOrWebsite: Joi.string().min(3),
  phoneOrFax: Joi.string().min(3)
});


export const validatePayload = (req, res, next) => {
  const { error } = truesightRequestSchema.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};

export const validatePayload1 = (req, res, next) => {
  const { error } = truesightRequestSchema1.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};


export const validateGrid = (req, res, next) => {
  const { error } = gridScheme.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};

export const validateId = (req, res, next) => {
  const { error } = idScheme.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};


export const validateGridPersonnel = (req, res, next) => {
  const { error } = gridPersonnelScheme.validate(req.body);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};


export const validatePortFolio = (req, res, next) => {
  const { error } = portfolioScheme.validate(req.query);
  console.log(error)
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  console.log("done")
  next();
};

const portfolioScheme = Joi.object({
  name: Joi.string().min(3).required(),
  primaryId: Joi.string().min(3).required(),
  city: Joi.string().min(3),
  country: Joi.string().min(2)
});

const ratingSchema = Joi.object({
  address: Joi.string().min(5),
  name: Joi.string().required(),
  bvd_id: Joi.string().min(3),
});

const addressImageSchema = Joi.object({
  orgName: Joi.string().min(2),
  name: Joi.string().min(2),
  address: Joi.string().min(5).required(),
  bvd_id: Joi.string().min(3).required(),
  sessionId: Joi.string().min(5).required(),
  ensId:  Joi.string().min(5).required(),
});

export const validateAddressImageQuery = (req, res, next) => {
  const { error } = addressImageSchema.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};

export const validateRatingQuery = (req, res, next) => {
  const { error } = ratingSchema.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};


// ---- AbuseIPDB / Cyber Risk ----
const cyberRiskSchema = Joi.object({
  companyName: Joi.string().min(2).required(),
  domain: Joi.string().required(),
  ens_id: Joi.string().min(3).required(),
  session_id: Joi.string().min(3).required(),
});

export const validateCyberRisk = (req, res, next) => {
  const { error } = cyberRiskSchema.validate(req.query);
  if (error)
    return res.status(400).json({
      status: 400,
      message: error.details[0].message,
    });
  next();
};