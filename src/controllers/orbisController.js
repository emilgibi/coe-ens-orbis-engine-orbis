import { getOrbisData } from "../mock/orbis.js";
import { updateInternalOrgDataService } from "../services/internalOrgModel.js";
import { handleResponse } from "../utils/helpers.js";
import { updatedinsertTable, updateTable, updatedinsertTable2, doesDataExist } from "../utils/db_utils.js";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/db.js";
import crypto from 'crypto';
import { json } from 'stream/consumers';
import axios from 'axios';

import {OrbisGridLogin} from '../utils/auth.js';
import {PortfolioGridLogin} from '../utils/auth.js';
import fs from "fs";
import langdetect from 'langdetect';

 
 const matchcompaniesresponse = JSON.parse(
   fs.readFileSync(new URL("../dummydata/matchcompanies.json", import.meta.url))
 );
 const supplierexternaltable = JSON.parse(
   fs.readFileSync(new URL("../dummydata/supplierexternaltable.json", import.meta.url))
 );
 const matchgridresponse = JSON.parse(
   fs.readFileSync(new URL("../dummydata/gridDataResponse.json", import.meta.url))
 );

//console.log("matchcompaniesresponse", matchcompaniesresponse);

export const updateInternalOrgData = async (req, res, next) => {
  const { orgName, orgIdentifier } = req.body;
  try {
    const orbisData = await getOrbisData(orgName, orgIdentifier);

    const result = await updateInternalOrgDataService(
      orgIdentifier,
      orbisData.BvDId
    );

    if (!result) {
      return handleResponse(res, 404, "Org not found");
    }

    return handleResponse(res, 200, "Org updated successfully", result);
  } catch (err) {
    next(err);
  }
};

const generateUniqueId = (inputString) => {
  // Use SHA-256 hash to create a consistent hash for the same input
  return crypto.createHash("sha256").update(inputString).digest("hex");
};

export const getCompanyData = async (req, res) => {
  const { orgName, orgCountry } = req.query;

  if (!orgName || !orgCountry) {
    return res.status(400).json({
      error: "Missing required query parameters: orgName, orgCountry",
    });
  }

  const endpoint = `${process.env.DOMAIN}v1/orbis/Companies/data`;

  const query = {
    WHERE: [
      {
        MATCH: {
          Criteria: {
            Name: orgName,
            Country: orgCountry,
            NationalId: "",
            State: "",
            City: "",
            Address: "",
            PostCode: "",
            EmailOrWebsite: "",
            PhoneOrFax: "",
          },
        },
      },
    ],
    SELECT: [
      "BVDID",
      "MATCH.NAME",
      "MATCH.NAME_INTERNATIONAL",
      "MATCH.ADDRESS",
      "MATCH.POSTCODE",
      "MATCH.CITY",
      "MATCH.COUNTRY",
      "MATCH.PHONEORFAX",
      "MATCH.EMAILORWEBSITE",
      "MATCH.NATIONAL_ID",
      "MATCH.STATE",
      "MATCH.ADDRESS_TYPE",
      "MATCH.HINT",
      "MATCH.SCORE",
    ],
  };

  try {
    //   const response = await axios.get(endpoint, {
    //       params: { QUERY: JSON.stringify(query) },
    //   });

    const response = matchcompaniesresponse;

    if (response.status === 200) {
      const data = response.data;

      let exactMatch = null;
      let potentialMatch = null;

      // Process the response data
      for (const companyData of data.Data) {
        const matchInfo = companyData.MATCH["0"];
        matchInfo["BVDID"] = companyData.BVDID;
        const hint = matchInfo?.HINT?.trim();

        if (hint === "Selected") {
          exactMatch = matchInfo;
          break;
        } else if (hint === "Potential" && !potentialMatch) {
          potentialMatch = matchInfo;
        }
      }

      const company = exactMatch || potentialMatch || null;

      if (company) {
        console.log("___company", company);
        const inputString =
          company.BVDID +
          "_" +
          company.NAME +
          "_" +
          company.NAME_INTERNATIONAL +
          "_" +
          company.ADDRESS +
          "_" +
          company.POSTCODE +
          "_" +
          company.CITY +
          "_" +
          company.STATE +
          "_" +
          company.ADDRESS_TYPE;
        const uniqueId = generateUniqueId(inputString);
        let response = {
          bvdid: company.BVDID,
          name: company.NAME,
          name_international: company.NAME_INTERNATIONAL,
          address: company.ADDRESS,
          postcode: company.POSTCODE,
          city: company.CITY,
          country: company.COUNTRY,
          phone_or_fax: company.PHONEORFAX,
          email_or_website: company.EMAILORWEBSITE,
          national_id: company.NATIONAL_ID,
          state: company.STATE,
          address_type: company.ADDRESS_TYPE,
          ens_id: uniqueId,
        };
        try {
          // Example database query
          console.log("updatedinsertTable");
          const tableName = "matchBvdid";
          const interted_response = await updatedinsertTable(
            tableName,
            response,
            uniqueId,
            uuidv4()
          );
          return res.status(200).json({
            success: true,
            message: "Successfully saved data",
            data: interted_response,
          });

          // const result = await pool.query(
          //     'INSERT INTO matchBvdid (bvdid, name, name_international, address, postcode, city, country, phone_or_fax, email_or_website, national_id, state, address_type, ens_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
          //     [company.BVDID, company.NAME, company.NAME_INTERNATIONAL, company.ADDRESS, company.POSTCODE, company.CITY, company.COUNTRY, company.PHONEORFAX, company.EMAILORWEBSITE, company.NATIONAL_ID, company.STATE, company.ADDRESS_TYPE, uniqueId],
          // );
          // return res.status(200).json({ success: true, message: "Successfully saved data", data: result.rows});
        } catch (error) {
          // Pass error to error-handling middleware
          response = {
            bvdid: company.BVDID,
            name: company.NAME,
            name_international: company.NAME_INTERNATIONAL,
            address: company.ADDRESS,
            postcode: company.POSTCODE,
            city: company.CITY,
            country: company.COUNTRY,
            phone_or_fax: company.PHONEORFAX,
            email_or_website: company.EMAILORWEBSITE,
            national_id: company.NATIONAL_ID,
            state: company.STATE,
            address_type: company.ADDRESS_TYPE,
            ens_id: uniqueId,
          };
          res
            .status(409)
            .json({ success: false, message: error.message, data: response });
        }
        return res.json(response);
      } else {
        return res.status(404).json({ error: "No valid match found." });
      }
    } else {
      return res
        .status(409)
        .json({ error: "API request failed.", details: response.data });
    }
  } catch (error) {
    console.error("Error fetching data from Orbis API:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const getTruesightCompanyData = async (req, res) => {
    const { orgName, orgCountry, sessionId, ensId, nationalId, state, city, address, postCode, emailOrWebsite, phoneOrFax} = req.query;

    if (!orgName || !orgCountry) {
        return res.status(400).json({ error: 'Missing required query parameters: orgName, orgCountry' });
    }

    // const endpoint = `${process.env.DOMAIN}v1/orbis/Companies/data`;
    const endpoint = `https://api.bvdinfo.com/v1/orbis/Companies/data`;

    const query = {
        WHERE: [
            {
                MATCH: {
                    Criteria: {
                        Name: orgName,
                        Country: orgCountry,
                        NationalId: nationalId || "",
                        State: state || "",
                        City: city || "",
                        Address: address || "",
                        PostCode: postCode || "",
                        EmailOrWebsite: emailOrWebsite || "",
                        PhoneOrFax: phoneOrFax || "",
                    },
                },
            },
        ],
        SELECT: [
            "BVDID",
            "MATCH.NAME",
            "MATCH.NAME_INTERNATIONAL",
            "MATCH.ADDRESS",
            "MATCH.POSTCODE",
            "MATCH.CITY",
            "MATCH.COUNTRY",
            "MATCH.PHONEORFAX",
            "MATCH.EMAILORWEBSITE",
            "MATCH.NATIONAL_ID",
            "MATCH.STATE",
            "MATCH.ADDRESS_TYPE",
            "MATCH.HINT",
            "MATCH.SCORE",
        ],
    };

    try {
        const headers = {
            'Content-Type': 'application/json',
            'ApiToken': '45U38110c76ac84342928687c6edb0687fa0'
        };

        const response = await axios.get(endpoint, {
            params: { QUERY: JSON.stringify(query) },
            headers: headers
        });

        // const response = matchcompaniesresponse;

        if (response.status === 200) {
            const data = response.data;

            return res.status(200).json({ success: true, message: "Successful", data: data["Data"]})
        } else {
            return res.status(409).json({ success: false, error: 'API request failed.', details: response.data });
        }
    } catch (error) {
        console.error('Error fetching data from Orbis API:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
  };

export const getTruesightCompanyData2 = async (req, res) => {
    const { orgName, orgCountry, sessionId, ensId, nationalId, state, city, address, postCode, emailOrWebsite, phoneOrFax} = req.query;

    const endpoint = `https://api.bvdinfo.com/v1/orbis/Companies/data`;

    const query = {
        WHERE: [
            {
                MATCH: {
                    Criteria: {
                        Name: orgName || "",
                        Country: orgCountry || "",
                        NationalId: nationalId || "",
                        State: state || "",
                        City: city || "",
                        Address: address || "",
                        PostCode: postCode || "",
                        EmailOrWebsite: emailOrWebsite || "",
                        PhoneOrFax: phoneOrFax || "",
                    },
                },
            },
        ],
        SELECT: [
            "BVDID",
            "MATCH.NAME",
            "MATCH.NAME_INTERNATIONAL",
            "MATCH.ADDRESS",
            "MATCH.POSTCODE",
            "MATCH.CITY",
            "MATCH.COUNTRY",
            "MATCH.PHONEORFAX",
            "MATCH.EMAILORWEBSITE",
            "MATCH.NATIONAL_ID",
            "MATCH.STATE",
            "MATCH.ADDRESS_TYPE",
            "MATCH.HINT",
            "MATCH.SCORE",
        ],
    };

    try {
        const headers = {
            'Content-Type': 'application/json',
            'ApiToken': '45U38110c76ac84342928687c6edb0687fa0'
        };

        const response = await axios.get(endpoint, {
            params: { QUERY: JSON.stringify(query) },
            headers: headers
        });

        // const response = matchcompaniesresponse;

        if (response.status === 200) {
            const data = response.data;

            return res.status(200).json({ success: true, message: "Successful", data: data["Data"]})
        } else {
            return res.status(409).json({ error: 'API request failed.', details: response.data });
        }
    } catch (error) {
        console.error('Error fetching data from Orbis API:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
  };
// matchBVDid

export const getOrbisCompanyData = async (req, res) => {
    const { bvdId, ensId, sessionId } = req.query;

    // BUG FIX 1: Validate all required params, not just bvdId
    if (!bvdId || !ensId || !sessionId) {
        return res.status(400).json({ error: 'Missing required query parameters: bvdId, ensId, sessionId' });
    }

    const endpoint = `https://api.bvdinfo.com/v1/orbis/Companies/data`;
    const query = {
        "WHERE": [
            { "BvDID": [bvdId] }
        ],
        "SELECT": [
            { "NAME": { "AS": "NAME" } },
            {"EMAIL": {"LIMIT":1,"AS":"EMAIL"}},
            {"ADDRESS_LINE1_LOCAL": {"AS":"ADDRESS_LINE1"}},
            {"ADDRESS_LINE2_LOCAL": {"AS":"ADDRESS_LINE2"}},
            {"ADDRESS_LINE3_LOCAL": {"AS":"ADDRESS_LINE3"}},
            {"ADDRESS_LINE4_LOCAL": {"AS":"ADDRESS_LINE4"}},
            {"POSTCODE_LOCAL": {"AS":"POSTCODE"}},
            { "COUNTRY": { "AS": "COUNTRY" } },
            { "CITY_STANDARDIZED": { "AS": "CITY_STANDARDIZED" } },
            {"STATUS": {"LIMIT":1,"AS":"STATUS"}},
            { "BVD_ID_NUMBER": { "AS": "BVD_ID_NUMBER" } },
            { "NATIONAL_ID": { "AS": "NATIONAL_ID" } },
            { "NATIONAL_ID_TYPE": { "AS": "NATIONAL_ID_TYPE" } },
            { "STANDARDISED_LEGAL_FORM": { "AS": "STANDARDISED_LEGAL_FORM" } },
            { "INCORPORATION_DATE": { "AS": "INCORPORATION_DATE" } },
            { "AKA_NAME": { "AS": "AKA_NAME" } },
            {"OPRE": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"OPRE"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"OPRE_1"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"OPRE_2"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"OPRE_3"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":0,"INDEXORYEAR":"0","AS":"OPRE_usd"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":0,"INDEXORYEAR":"1","AS":"OPRE_1_usd"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":0,"INDEXORYEAR":"2","AS":"OPRE_2_usd"}},
            {"OPRE": {"CURRENCY":"USD","UNIT":0,"INDEXORYEAR":"3","AS":"OPRE_3_usd"}},
            {"PL": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"PL"}},
            {"PL": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"PL_1"}},
            {"PL": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"PL_2"}},
            {"PL": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"PL_3"}},
            {"CURR": {"UNIT":0,"INDEXORYEAR":"0","AS":"CURR"}},
            {"CURR": {"UNIT":0,"INDEXORYEAR":"1","AS":"CURR_1"}},
            {"CURR": {"UNIT":0,"INDEXORYEAR":"2","AS":"CURR_2"}},
            {"CURR": {"UNIT":0,"INDEXORYEAR":"3","AS":"CURR_3"}},
            { "EBTA": { "MODELID": "IND", "CURRENCY": "USD", "UNIT": 3, "INDEXORYEAR": "0", "AS": "EBTA" } },
            { "EBTA": { "MODELID": "IND", "CURRENCY": "USD", "UNIT": 3, "INDEXORYEAR": "1", "AS": "EBTA_1" } },
            { "EBTA": { "MODELID": "IND", "CURRENCY": "USD", "UNIT": 3, "INDEXORYEAR": "2", "AS": "EBTA_2" } },
            { "EBTA": { "MODELID": "IND", "CURRENCY": "USD", "UNIT": 3, "INDEXORYEAR": "3", "AS": "EBTA_3" } },
            { "ROE": { "UNIT": 0, "INDEXORYEAR": "0", "AS": "ROE" } },
            { "ROE": { "UNIT": 0, "INDEXORYEAR": "1", "AS": "ROE_1" } },
            { "ROE": { "UNIT": 0, "INDEXORYEAR": "2", "AS": "ROE_2" } },
            { "ROE": { "UNIT": 0, "INDEXORYEAR": "3", "AS": "ROE_3" } },
            { "FSPulse_PaymentRatingScore": { "UNIT": 0, "INDEXORYEAR": "0", "AS": "FSPulse_PaymentRatingScore" } },
            { "REACMORRAT": { "INDEXORYEAR": "0", "AS": "REACMORRAT" } },
            { "MODEFINNF": { "INDEXORYEAR": "0", "AS": "MODEFINNF" } },
            { "MODEFINNFDATE": { "INDEXORYEAR": "0", "AS": "MODEFINNFDATE" } },
            { "ESG_GLOBAL_SCORE": { "INDEXORYEAR": "0", "AS": "ESG_GLOBAL_SCORE" } },
            { "ESG_GLOBAL_SCORE_CLASS": { "INDEXORYEAR": "0", "AS": "ESG_GLOBAL_SCORE_CLASS" } },
            { "ESG_ENV_SCORE": { "INDEXORYEAR": "0", "AS": "ESG_ENV_SCORE" } },
            { "ESG_SOC_SCORE": { "INDEXORYEAR": "0", "AS": "ESG_SOC_SCORE" } },
            { "ESG_GOV_SCORE": { "INDEXORYEAR": "0", "AS": "ESG_GOV_SCORE" } },
            { "BITSIGHT_UPDATED_DATE": { "INDEXORYEAR": "0", "AS": "BITSIGHT_UPDATED_DATE" } },
            { "BITSIGHT_SECURITY_RATING": { "INDEXORYEAR": "0", "AS": "BITSIGHT_SECURITY_RATING" } },
            { "BITSIGHT_VECTOR_BOTNET_INFECTIONS": { "INDEXORYEAR": "0", "AS": "BITSIGHT_VECTOR_BOTNET_INFECTIONS" } },
            { "BITSIGHT_VECTOR_MALWARE_SERVERS": { "INDEXORYEAR": "0", "AS": "BITSIGHT_VECTOR_MALWARE_SERVERS" } },
            { "BITSIGHT_VECTOR_TLS_SSL_CERTIFICATES": { "INDEXORYEAR": "0", "AS": "BITSIGHT_VECTOR_TLS_SSL_CERTIFICATES" } },
            { "BITSIGHT_VECTOR_WEB_APPLICATION_HEADERS": { "INDEXORYEAR": "0", "AS": "BITSIGHT_VECTOR_WEB_APPLICATION_HEADERS" } },
            { "IMPLIED_CYBER_THREAT_RISK_METRIC": { "INDEXORYEAR": "0", "AS": "IMPLIED_CYBER_THREAT_RISK_METRIC" } },
            { "IMPLIED_CYBER_THREAT_DATE": { "INDEXORYEAR": "0", "AS": "IMPLIED_CYBER_THREAT_DATE" } },
            {"SH_NAME": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_NAME"}},
            {"SH_DIRECT_PCT": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_DIRECT_PCT"}},
            {"SH_TOTAL_PCT": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_TOTAL_PCT"}},
            {"SH_GRID_MATCH_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_GRID_MATCH_INDICATOR_FORMATTED"}},
            {"SH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"SH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"SH_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"SH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"SH_COUNT": {"FILTERS": "Filter.Name=Shareholders;Shareholders.RemoveVessels=0;Shareholders.RemoveBranches=0;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.ArchivedDatesFilter=0;Shareholders.RecursionLevel=1;", "AS": "SH_COUNT"}},
            {"CORPORATE_GROUP_SIZE_LABEL": {"FILTERS": "Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "CORPORATE_GROUP_SIZE_LABEL"}},
            {"SUB_COUNT": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_COUNT"}},
            {"SUB_NAME": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_NAME"}},
            {"SUB_DIRECT_PCT": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_DIRECT_PCT"}},
            {"SUB_TOTAL_PCT": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_TOTAL_PCT"}},
            {"SUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"SUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"SUB_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"SUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"ESG_COMPUTATION_DATE": {"INDEXORYEAR":"0","AS":"ESG_COMPUTATION_DATE"}},
            {"MORRAT": {"INDEXORYEAR":"0","AS":"MORRAT"}},
            {"MORE_YEAR": {"INDEXORYEAR":"0","AS":"MORE_YEAR"}},
            {"REACMORE_DATE": {"INDEXORYEAR":"0","AS":"REACMORE_DATE"}},
            {"ENTITY_TYPE": {"AS":"ENTITY_TYPE"}},
            {"CLOSING_DATE": {"INDEXORYEAR":"0","AS":"CLOSING_DATE"}},
            {"CLOSING_DATE": {"INDEXORYEAR":"1","AS":"CLOSING_DATE_1"}},
            {"CLOSING_DATE": {"INDEXORYEAR":"2","AS":"CLOSING_DATE_2"}},
            {"CLOSING_DATE": {"INDEXORYEAR":"3","AS":"CLOSING_DATE_3"}},
            {"SOLR": {"UNIT":0,"INDEXORYEAR":"0","AS":"SOLR"}},
            {"SOLR": {"UNIT":0,"INDEXORYEAR":"1","AS":"SOLR_1"}},
            {"SOLR": {"UNIT":0,"INDEXORYEAR":"2","AS":"SOLR_2"}},
            {"SOLR": {"UNIT":0,"INDEXORYEAR":"3","AS":"SOLR_3"}},
            {"RCEM": {"UNIT":0,"INDEXORYEAR":"0","AS":"RCEM"}},
            {"RCEM": {"UNIT":0,"INDEXORYEAR":"1","AS":"RCEM_1"}},
            {"RCEM": {"UNIT":0,"INDEXORYEAR":"2","AS":"RCEM_2"}},
            {"RCEM": {"UNIT":0,"INDEXORYEAR":"3","AS":"RCEM_3"}},
            {"PRMA": {"UNIT":0,"INDEXORYEAR":"0","AS":"PRMA"}},
            {"PRMA": {"UNIT":0,"INDEXORYEAR":"1","AS":"PRMA_1"}},
            {"PRMA": {"UNIT":0,"INDEXORYEAR":"2","AS":"PRMA_2"}},
            {"PRMA": {"UNIT":0,"INDEXORYEAR":"3","AS":"PRMA_3"}},
            {"SHFD": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"SHFD"}},
            {"SHFD": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"SHFD_1"}},
            {"SHFD": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"SHFD_2"}},
            {"SHFD": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"SHFD_3"}},
            {"TOAS": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"TOAS"}},
            {"TOAS": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"TOAS_1"}},
            {"TOAS": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"TOAS_2"}},
            {"TOAS": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"TOAS_3"}},
            {"CF": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"CF"}},
            {"CF": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"CF_1"}},
            {"CF": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"CF_2"}},
            {"CF": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"CF_3"}},
            {"RSHF": {"UNIT":0,"INDEXORYEAR":"0","AS":"RSHF"}},
            {"RSHF": {"UNIT":0,"INDEXORYEAR":"1","AS":"RSHF_1"}},
            {"RSHF": {"UNIT":0,"INDEXORYEAR":"2","AS":"RSHF_2"}},
            {"RSHF": {"UNIT":0,"INDEXORYEAR":"3","AS":"RSHF_3"}},
            {"PLBT": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"PLBT"}},
            {"PLBT": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"1","AS":"PLBT_1"}},
            {"PLBT": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"2","AS":"PLBT_2"}},
            {"PLBT": {"CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"3","AS":"PLBT_3"}},
            {"CSH_NAME": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_NAME"}},
            {"CSH_DIRECT_PCT": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_DIRECT_PCT"}},
            {"CSH_TOTAL_PCT": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_TOTAL_PCT"}},
            {"CSH_POSSIBLE_PCT_CHANGE_DESCRIPTION": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_POSSIBLE_PCT_CHANGE_DESCRIPTION"}},
            {"CSH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"CSH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"CSH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"CSH_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"BOI_NAME": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_NAME"}},
            {"BOI_DIRECT_PCT": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_DIRECT_PCT"}},
            {"BOI_TOTAL_PCT": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_TOTAL_PCT"}},
            {"BOI_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"BOI_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"BOI_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"BOI_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BOI_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"OUB_NAME": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_NAME"}},
            {"OUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"OUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"OUB_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"OUBI_COUNT": {"FILTERS": "Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUBI_COUNT"}},
            {"CPYCONTACTS_HEADER_FullNameOriginalLanguagePreferred": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_FullNameOriginalLanguagePreferred"}},
            {"CPYCONTACTS_HEADER_IdDirector": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_IdDirector"}},
            {"CPYCONTACTS_HEADER_GRID_MATCH_SANCTIONS_INDICATOR": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_GRID_MATCH_SANCTIONS_INDICATOR"}},
            {"CPYCONTACTS_HEADER_GRID_MATCH_WATCHLIST_INDICATOR": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_GRID_MATCH_WATCHLIST_INDICATOR"}},
            {"CPYCONTACTS_HEADER_GRID_MATCH_PEP_INDICATOR": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_GRID_MATCH_PEP_INDICATOR"}},
            {"CPYCONTACTS_HEADER_GRID_MATCH_MEDIA_INDICATOR": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_GRID_MATCH_MEDIA_INDICATOR"}},
            {"GUO_ENTITY_TYPE": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_ENTITY_TYPE"}},
            {"CSH_ENTITY_TYPE": {"FILTERS":"Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_ENTITY_TYPE"}},
            {"EMPL": {"UNIT":0,"INDEXORYEAR":"0","AS":"EMPL"}},
            {"WEBSITE": {"LIMIT":1,"AS":"WEBSITE"}},
            {"BO_NAME": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_NAME"}},
            {"BO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"BO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"BO_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"BO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"OUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}},
            {"OUB_POSSIBLE_PCT_CHANGE_DESCRIPTION": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_POSSIBLE_PCT_CHANGE_DESCRIPTION"}},
            {"BO_POSSIBLE_PCT_CHANGE_DESCRIPTION": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_POSSIBLE_PCT_CHANGE_DESCRIPTION"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO1": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO1"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO2": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO2"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO10": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO10"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO3": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO3"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO4": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO4"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO11": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO11"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO5": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO5"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO6": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO6"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO7": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO7"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO8": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO8"}},
            {"MODE_FINANCE_MORE_EXPL_RATIO9": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_RATIO9"}},
            {"MODE_FINANCE_MORE_EXPL_BANK_RATIO1": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_BANK_RATIO1"}},
            {"MODE_FINANCE_MORE_EXPL_BANK_RATIO2": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_BANK_RATIO2"}},
            {"MODE_FINANCE_MORE_EXPL_BANK_RATIO3": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_BANK_RATIO3"}},
            {"MODE_FINANCE_MORE_EXPL_BANK_RATIO4": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_BANK_RATIO4"}},
            {"MODE_FINANCE_MORE_EXPL_BANK_RATIO5": {"INDEXORYEAR":"0","AS":"MODE_FINANCE_MORE_EXPL_BANK_RATIO5"}},
            {"REACMORE_EXPL_RATIO3": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO3"}},
            {"REACMORE_EXPL_RATIO2": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO2"}},
            {"REACMORE_EXPL_RATIO1": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO1"}},
            {"REACMORE_EXPL_RATIO4": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO4"}},
            {"REACMORE_EXPL_RATIO5": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO5"}},
            {"REACMORE_EXPL_RATIO7": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO7"}},
            {"REACMORE_EXPL_RATIO8": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO8"}},
            {"REACMORE_EXPL_RATIO9": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO9"}},
            {"REACMORE_EXPL_RATIO10": {"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO10"}},
            {"REACMORE_EXPL_RATIO10VAL": {"UNIT":0,"INDEXORYEAR":"0","AS":"REACMORE_EXPL_RATIO10VAL"}},
            {"LOAN": {"MODELID":"IND","CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"LOAN"}},
            {"LTDB": {"MODELID":"IND","CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"LTDB"}},
            {"14041": {"MODELID":"IND","CURRENCY":"USD","UNIT":3,"INDEXORYEAR":"0","AS":"14041"}},
            {"LEGAL_EVENTS_DATE": {"AS":"LEGAL_EVENTS_DATE"}},
            {"LEGAL_EVENTS_DESCRIPTION": {"AS":"LEGAL_EVENTS_DESCRIPTION"}},
            {"LEGAL_EVENTS_SOURCE": {"AS":"LEGAL_EVENTS_SOURCE"}},
            {"LEGAL_EVENTS_ID": {"AS":"LEGAL_EVENTS_ID"}},
            {"LEGAL_EVENTS_TYPES_VALUE": {"AS":"LEGAL_EVENTS_TYPES_VALUE"}},
            {"LEGAL_EVENTS_DETAILS": {"AS":"LEGAL_EVENTS_DETAILS"}},
            {"CPYCONTACTS_MEMBERSHIP_Function": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_Function"}},
            {"CPYCONTACTS_MEMBERSHIP_CurrentPrevious": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_CurrentPrevious"}},
            {"CPYCONTACTS_MEMBERSHIP_DepartmentFromHierCodeFall2009": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_DepartmentFromHierCodeFall2009"}},
            {"CPYCONTACTS_MEMBERSHIP_LevelFromHierCodeFall2009": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_LevelFromHierCodeFall2009"}},
            {"CPYCONTACTS_MEMBERSHIP_IsAShareholderFormatted": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_IsAShareholderFormatted"}},
            {"BO_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_BVD_ID_NUMBER"}},
            {"BO_UCI": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "BO_UCI"}},
            {"OUB_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=BeneficialOwnersFilter;BeneficialOwnersFilter.MinPercentBOFirstLevel=2500;BeneficialOwnersFilter.MinPercentBOHigherLevel=5001;", "AS": "OUB_BVD_ID_NUMBER"}},
            {"SH_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=Shareholders;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.RemoveBranches=0;Shareholders.RemoveVessels=0;Shareholders.RecursionLevel=1;", "AS": "SH_BVD_ID_NUMBER"}},
            {"SH_UCI": {"FILTERS":"Filter.Name=Shareholders;Shareholders.AlsoSelectNotListedShareholders=1;Shareholders.RemoveBranches=0;Shareholders.RemoveVessels=0;Shareholders.RecursionLevel=1;", "AS": "SH_UCI"}},
            {"SUB_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=Subsidiaries;Subsidiaries.RemoveVessels=0;Subsidiaries.RemoveBranches=1;Subsidiaries.ControlShareholders=0;Subsidiaries.UltimatesIASOnlyEqU=1;", "AS": "SUB_BVD_ID_NUMBER"}},
            {"CSH_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_BVD_ID_NUMBER"}},
            {"CSH_UCI": {"FILTERS":"Filter.Name=ControllingShareholders;ControllingShareholders.RemoveVessels=1;ControllingShareholders.ControlShareholders=0;ControllingShareholders.UltimatesIASOnlyEqU=1;", "AS": "CSH_UCI"}},
            {"US_STATE": {"AS":"US_STATE"}},
            {"CPYCONTACTS_MEMBERSHIP_BeginningNominationDate": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_BeginningNominationDate"}},
            {"CPYCONTACTS_MEMBERSHIP_EndExpirationDate": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_MEMBERSHIP_EndExpirationDate"}},
            {"CPYCONTACTS_HEADER_BvdId": {"FILTERS":"Filter.Name=ContactsFilter;ContactsFilter.IfHomeOnlyReturnCountry=1;ContactsFilter.SourcesToExcludeQueryString=99B|59B|69B|70B|0|278;", "AS": "CPYCONTACTS_HEADER_BvdId"}},
            {"GUO_NAME": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_NAME"}},
            {"GUO_BVD_ID_NUMBER": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_BVD_ID_NUMBER"}},
            {"GUO_UCI": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_UCI"}},
            {"GUO_DIRECT_PCT": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_DIRECT_PCT"}},
            {"GUO_TOTAL_PCT": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_TOTAL_PCT"}},
            {"GUO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED"}},
            {"GUO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED"}},
            {"GUO_GRID_MATCH_PEP_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_GRID_MATCH_PEP_INDICATOR_FORMATTED"}},
            {"GUO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED": {"FILTERS":"Filter.Name=GlobalUltimateOwners;GlobalUltimateOwners.RemoveVessels=1;GlobalUltimateOwners.IsBvDLiensNote131=1;GlobalUltimateOwners.ControlShareholders=0;", "AS": "GUO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED"}}
        ]
    };

    const headers = {
        'Content-Type': 'application/json',
        'ApiToken': process.env.ORBIS_API_TOKEN   // BUG FIX 2: Move API key to env variable
    };

    try {
        // BUG FIX 3: Check the API actually returned data before processing
        const response_data = await axios.post(endpoint, query, { headers });

        if (!response_data?.data?.Data?.length) {
            return res.status(404).json({ success: false, error: 'No data found for the given bvdId.' });
        }

        let data = response_data.data.Data[0];
        const getValue = (value) => value ?? null;

        // BUG FIX 4: Use getValue() for all array entries to safely handle undefined
        let opreArray     = [getValue(data?.OPRE),   getValue(data?.OPRE_1),   getValue(data?.OPRE_2),   getValue(data?.OPRE_3)];
        let opre_usdArray = [getValue(data?.OPRE_usd), getValue(data?.OPRE_1_usd), getValue(data?.OPRE_2_usd), getValue(data?.OPRE_3_usd)];
        let plArray       = [getValue(data?.PL),     getValue(data?.PL_1),     getValue(data?.PL_2),     getValue(data?.PL_3)];
        let currArray     = [getValue(data?.CURR),   getValue(data?.CURR_1),   getValue(data?.CURR_2),   getValue(data?.CURR_3)];
        let solrArray     = [getValue(data?.SOLR),   getValue(data?.SOLR_1),   getValue(data?.SOLR_2),   getValue(data?.SOLR_3)];
        let rcemArrray    = [getValue(data?.RCEM),   getValue(data?.RCEM_1),   getValue(data?.RCEM_2),   getValue(data?.RCEM_3)];
        let prmaArray     = [getValue(data?.PRMA),   getValue(data?.PRMA_1),   getValue(data?.PRMA_2),   getValue(data?.PRMA_3)];
        let shfdArray     = [getValue(data?.SHFD),   getValue(data?.SHFD_1),   getValue(data?.SHFD_2),   getValue(data?.SHFD_3)];
        let toasArray     = [getValue(data?.TOAS),   getValue(data?.TOAS_1),   getValue(data?.TOAS_2),   getValue(data?.TOAS_3)];
        let cfArray       = [getValue(data?.CF),     getValue(data?.CF_1),     getValue(data?.CF_2),     getValue(data?.CF_3)];
        let rshfArray     = [getValue(data?.RSHF),   getValue(data?.RSHF_1),   getValue(data?.RSHF_2),   getValue(data?.RSHF_3)];
        let plbtArray     = [getValue(data?.PLBT),   getValue(data?.PLBT_1),   getValue(data?.PLBT_2),   getValue(data?.PLBT_3)];
        let ebdtaArray    = [getValue(data?.EBTA),   getValue(data?.EBTA_1),   getValue(data?.EBTA_2),   getValue(data?.EBTA_3)];
        let roeArray      = [getValue(data?.ROE),    getValue(data?.ROE_1),    getValue(data?.ROE_2),    getValue(data?.ROE_3)];

        // BUG FIX 5: closingDate — fall back to index label when CLOSING_DATE is null
        // so financial values are NOT discarded just because closing date is missing
        let closingDate = [
            getValue(data?.CLOSING_DATE?.split("T")[0]),
            getValue(data?.CLOSING_DATE_1?.split("T")[0]),
            getValue(data?.CLOSING_DATE_2?.split("T")[0]),
            getValue(data?.CLOSING_DATE_3?.split("T")[0])
        ];

        function isSignificant(DirectPctValue) {
            const rawValue = String(DirectPctValue || "").toLowerCase();
            if (/\b(mo|so|wo|jo|t|fc|reg|dm|gp|ve|br|cqp1)\b/.test(rawValue)) {
                return true;
            }
            const allMatches = rawValue.match(/\d+(\.\d+)?/g);
            const numericValues = allMatches ? allMatches.map(parseFloat) : [];
            const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
            return maxValue >= 5;
        }

        function createJsonFromArrays(arr1, arr2) {
            if (arr1.length !== arr2.length) {
                throw new Error("Both arrays must have the same length");
            }
            let result = arr1
                .map((item, index) => {
                    const isEmptyArray = Array.isArray(item) && item.length === 0;
                    if (item !== null && item !== undefined && item !== 0 && !isEmptyArray) {
                        return { "value": item, "closing_date": arr2[index] };
                    } else {
                        return null;
                    }
                })
                .filter(item => item !== null);
            return result.length > 0 ? JSON.stringify(result, null, 2) : null;
        }

        function formatOwnershipData(names, directPct, totalPct, sanctions, watchlist, pep, media, bvd_id, contact_id) {
            if (!Array.isArray(names)) {
                return null;
            }
            const ensureArray = (arr) => (Array.isArray(arr) ? arr : []);
            directPct   = ensureArray(directPct);
            totalPct    = ensureArray(totalPct);
            sanctions   = ensureArray(sanctions);
            watchlist   = ensureArray(watchlist);
            pep         = ensureArray(pep);
            media       = ensureArray(media);
            bvd_id      = ensureArray(bvd_id);
            contact_id  = ensureArray(contact_id);

            return names.map((name, index) => ({
                "name": name || "Unknown",
                "bvd_id": bvd_id[index] !== undefined ? bvd_id[index] : "n.a",
                "contact_id": contact_id[index] !== undefined ? contact_id[index] : "n.a",
                "direct_ownership": directPct[index] !== undefined ? directPct[index] : "n.a",
                "total_ownership": totalPct[index] !== undefined ? totalPct[index] : "n.a",
                "sanctions_indicator": sanctions[index] !== undefined ? sanctions[index] : "n.a",
                "watchlist_indicator": watchlist[index] !== undefined ? watchlist[index] : "n.a",
                "pep_indicator": pep[index] !== undefined ? pep[index] : "n.a",
                "media_indicator": media[index] !== undefined ? media[index] : "n.a",
                "significance": isSignificant(directPct[index] !== undefined ? directPct[index] : "n.a")
            }));
        }

        const PL       = createJsonFromArrays(plArray, closingDate);
        const OPRE     = createJsonFromArrays(opreArray, closingDate);
        const OPRE_usd = createJsonFromArrays(opre_usdArray, closingDate);
        const CURR     = createJsonFromArrays(currArray, closingDate);
        const SOLR     = createJsonFromArrays(solrArray, closingDate);
        const RCEM     = createJsonFromArrays(rcemArrray, closingDate);
        const PRMA     = createJsonFromArrays(prmaArray, closingDate);
        const SHFD     = createJsonFromArrays(shfdArray, closingDate);
        const TOAS     = createJsonFromArrays(toasArray, closingDate);
        const CF       = createJsonFromArrays(cfArray, closingDate);
        const RSHF     = createJsonFromArrays(rshfArray, closingDate);
        const PLBT     = createJsonFromArrays(plbtArray, closingDate);
        const EBTA     = createJsonFromArrays(ebdtaArray, closingDate);
        const ROE      = createJsonFromArrays(roeArray, closingDate);

        const shareholders = formatOwnershipData(
            data.SH_NAME, data.SH_DIRECT_PCT, data.SH_TOTAL_PCT,
            data.SH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED,
            data.SH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED,
            data.SH_GRID_MATCH_PEP_INDICATOR_FORMATTED,
            data.SH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED,
            data.SH_BVD_ID_NUMBER, data.SH_UCI
        ) || null;

        const global_ultimate_owner = formatOwnershipData(
            data.GUO_NAME, data.GUO_DIRECT_PCT, data.GUO_TOTAL_PCT,
            data.GUO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED,
            data.GUO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED,
            data.GUO_GRID_MATCH_PEP_INDICATOR_FORMATTED,
            data.GUO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED,
            data.GUO_BVD_ID_NUMBER, data.GUO_UCI
        ) || null;

        const ultimately_owned_subsidiaries = formatOwnershipData(
            data.SUB_NAME, data.SUB_DIRECT_PCT, data.SUB_TOTAL_PCT,
            data.SUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED,
            data.SUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED,
            data.SUB_GRID_MATCH_PEP_INDICATOR_FORMATTED,
            data.SUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED,
            data.SUB_BVD_ID_NUMBER, []
        ) || null;

        const controlling_shareholders = formatOwnershipData(
            data.CSH_NAME, data.CSH_DIRECT_PCT, data.CSH_TOTAL_PCT,
            data.CSH_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED,
            data.CSH_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED,
            data.CSH_GRID_MATCH_PEP_INDICATOR_FORMATTED,
            data.CSH_GRID_MATCH_MEDIA_INDICATOR_FORMATTED,
            data.CSH_BVD_ID_NUMBER, data.CSH_UCI
        ) || null;

        const beneficial_owners_intermediatory = data.BOI_NAME?.map((_, ownerIndex) =>
            data.BOI_NAME[ownerIndex].map((name, index) => ({
                "name": name || "Unknown",
                "direct_ownership": data.BOI_DIRECT_PCT?.[ownerIndex]?.[index] || "n.a",
                "total_ownership": data.BOI_TOTAL_PCT?.[ownerIndex]?.[index] || "n.a",
                "sanctions_indicator": data.BOI_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED?.[ownerIndex]?.[index] || "n.a",
                "watchlist_indicator": data.BOI_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED?.[ownerIndex]?.[index] || "n.a",
                "pep_indicator": data.BOI_GRID_MATCH_PEP_INDICATOR_FORMATTED?.[ownerIndex]?.[index] || "n.a",
                "media_indicator": data.BOI_GRID_MATCH_MEDIA_INDICATOR_FORMATTED?.[ownerIndex]?.[index] || "n.a",
                "significance": isSignificant(data.BOI_DIRECT_PCT?.[ownerIndex] || "n.a")
            }))
        ) || null;

        const other_ultimate_beneficiary = Array.isArray(data.OUB_NAME) ?
            data.OUB_NAME.map((name, index) => ({
                "name": name || "Unknown",
                "bvd_id": data.OUB_BVD_ID_NUMBER?.[index] || "n.a",
                "sanctions_indicator": data.OUB_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED?.[index] || "n.a",
                "watchlist_indicator": data.OUB_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED?.[index] || "n.a",
                "pep_indicator": data.OUB_GRID_MATCH_PEP_INDICATOR_FORMATTED?.[index] || "n.a",
                "media_indicator": data.OUB_GRID_MATCH_MEDIA_INDICATOR_FORMATTED?.[index] || "n.a",
                "possible percentage change": data.OUB_POSSIBLE_PCT_CHANGE_DESCRIPTION?.[index] || "n.a",
                "significance": true
            }))
            : null;

        const beneficial_owners = Array.isArray(data.BO_NAME) ?
            data.BO_NAME.map((name, index) => ({
                "name": name || "Unknown",
                "bvd_id": data.BO_BVD_ID_NUMBER?.[index] || "n.a",
                "contact_id": data.BO_UCI?.[index] || "n.a",
                "sanctions_indicator": data.BO_GRID_MATCH_SANCTIONS_INDICATOR_FORMATTED?.[index] || "n.a",
                "watchlist_indicator": data.BO_GRID_MATCH_WATCHLIST_INDICATOR_FORMATTED?.[index] || "n.a",
                "pep_indicator": data.BO_GRID_MATCH_PEP_INDICATOR_FORMATTED?.[index] || "n.a",
                "media_indicator": data.BO_GRID_MATCH_MEDIA_INDICATOR_FORMATTED?.[index] || "n.a",
                "possible percentage change": data.BO_POSSIBLE_PCT_CHANGE_DESCRIPTION?.[index] || "n.a",
                "significance": true
            }))
            : null;

        const management = Array.isArray(data.CPYCONTACTS_HEADER_FullNameOriginalLanguagePreferred) ?
            Array.from(new Map(
                data.CPYCONTACTS_HEADER_IdDirector.map((id, index) => [
                    id,
                    {
                        "name": data.CPYCONTACTS_HEADER_FullNameOriginalLanguagePreferred?.[index] || "Unknown",
                        "id": id || "n.a",
                        "job_title": data.CPYCONTACTS_MEMBERSHIP_JobTitle?.[index] || "n.a",
                        "department": data.CPYCONTACTS_MEMBERSHIP_DepartmentorBoard?.[index] || "n.a",
                        "current_or_previous": data.CPYCONTACTS_MEMBERSHIP_Current_or_Previous?.[index] || "n.a",
                        "appointment_date": data.CPYCONTACTS_MEMBERSHIP_BeginningNominationDate?.[index] || "n.a",
                        "resignation_date": data.CPYCONTACTS_MEMBERSHIP_EndExpirationDate?.[index] || "n.a",
                        "associated_bvd_id": data.CPYCONTACTS_HEADER_BvdId?.[index] || "n.a",
                        "is_shareholder": data.CPYCONTACTS_MEMBERSHIP_IsAShareholder?.[index] || "n.a",
                        "heirarchy": data.CPYCONTACTS_MEMBERSHIP_Level?.[index] || "n.a",
                        "sanctions_indicator": data.CPYCONTACTS_HEADER_GRID_MATCH_SANCTIONS_INDICATOR?.[index] || "n.a",
                        "watchlist_indicator": data.CPYCONTACTS_HEADER_GRID_MATCH_WATCHLIST_INDICATOR?.[index] || "n.a",
                        "pep_indicator": data.CPYCONTACTS_HEADER_GRID_MATCH_PEP_INDICATOR?.[index] || "n.a",
                        "media_indicator": data.CPYCONTACTS_HEADER_GRID_MATCH_MEDIA_INDICATOR?.[index] || "n.a"
                    }
                ])
            ).values())
            : null;

        let pr_more_risk_score_ratio = {
            "leverage ratio": data.MODE_FINANCE_MORE_EXPL_RATIO1 || "n.a",
            "assets to debt": data.MODE_FINANCE_MORE_EXPL_RATIO2 || "n.a",
            "fixed assets coverage ratio": data.MODE_FINANCE_MORE_EXPL_RATIO10 || "n.a",
            "current ratio": data.MODE_FINANCE_MORE_EXPL_RATIO3 || "n.a",
            "quick ratio": data.MODE_FINANCE_MORE_EXPL_RATIO4 || "n.a",
            "cash conversion cycle(CCC)": data.MODE_FINANCE_MORE_EXPL_RATIO11 || "n.a",
            "return on investment(ROI)": data.MODE_FINANCE_MORE_EXPL_RATIO5 || "n.a",
            "return on equity(ROE)": data.MODE_FINANCE_MORE_EXPL_RATIO6 || "n.a",
            "asset turnover": data.MODE_FINANCE_MORE_EXPL_RATIO7 || "n.a",
            "profit margin": data.MODE_FINANCE_MORE_EXPL_RATIO8 || "n.a",
            "interest paid coverage": data.MODE_FINANCE_MORE_EXPL_RATIO9 || "n.a",
            "return on assets(ROA)": data.MODE_FINANCE_MORE_EXPL_BANK_RATIO1 || "n.a",
            "total capital ratio(TCR)": data.MODE_FINANCE_MORE_EXPL_BANK_RATIO2 || "n.a",
            "loan impairment charge weight": data.MODE_FINANCE_MORE_EXPL_BANK_RATIO3 || "n.a",
            "impaired loans ratio": data.MODE_FINANCE_MORE_EXPL_BANK_RATIO4 || "n.a",
            "cost on income": data.MODE_FINANCE_MORE_EXPL_BANK_RATIO5 || "n.a"
        };
        pr_more_risk_score_ratio = Object.values(pr_more_risk_score_ratio).every(value => value === "n.a") ? null : pr_more_risk_score_ratio;

        let pr_reactive_more_risk_score_ratio = {
            "assets to debt(forecasted)": data.REACMORE_EXPL_RATIO3 || "n.a",
            "financial leverage ratio(forecasted)": data.REACMORE_EXPL_RATIO2 || "n.a",
            "leverage ratio(forecasted)": data.REACMORE_EXPL_RATIO1 || "n.a",
            "current ratio(forecasted)": data.REACMORE_EXPL_RATIO4 || "n.a",
            "quick ratio(forecasted)": data.REACMORE_EXPL_RATIO5 || "n.a",
            "return on investment(ROI)(forecasted)": data.REACMORE_EXPL_RATIO7 || "n.a",
            "Return on equity(ROE)(forecasted)": data.REACMORE_EXPL_RATIO8 || "n.a",
            "Asset turnover (forecasted)": data.REACMORE_EXPL_RATIO9 || "n.a",
            "EBITDA sales ratio(forecasted)": data.REACMORE_EXPL_RATIO10 || "n.a"
        };
        pr_reactive_more_risk_score_ratio = Object.values(pr_reactive_more_risk_score_ratio).every(value => value === "n.a") ? null : pr_reactive_more_risk_score_ratio;

        const default_events = [];
        for (let i = 0; i < (data.LEGAL_EVENTS_DATE?.length || 0); i++) {
            const typesValue = Array.isArray(data.LEGAL_EVENTS_TYPES_VALUE?.[i])
                ? data.LEGAL_EVENTS_TYPES_VALUE[i]
                : [];
            if (typesValue.some(value => String(value).toLowerCase() === "default")) {
                default_events.push({
                    "LEGAL_EVENTS_DATE": data.LEGAL_EVENTS_DATE?.[i] || null,
                    "LEGAL_EVENTS_DESCRIPTION": data.LEGAL_EVENTS_DESCRIPTION?.[i] || null,
                    "LEGAL_EVENTS_SOURCE": data.LEGAL_EVENTS_SOURCE?.[i] || null,
                    "LEGAL_EVENTS_ID": data.LEGAL_EVENTS_ID?.[i] || null,
                    "LEGAL_EVENTS_TYPES_VALUE": typesValue,
                    "LEGAL_EVENTS_DETAILS": data.LEGAL_EVENTS_DETAILS?.[i] || null
                });
            }
        }

        let response = {
            name: data.NAME || null,
            country: data.COUNTRY || null,
            location: [data.CITY_STANDARDIZED, data.US_STATE, data.COUNTRY].filter(Boolean).join(', ') || null,
            address: [data.ADDRESS_LINE1, data.ADDRESS_LINE2, data.ADDRESS_LINE3, data.ADDRESS_LINE4, data.POSTCODE, data.CITY_STANDARDIZED, data.US_STATE, data.COUNTRY].filter(Boolean).join(', ') || null,
            is_active: data.STATUS?.[0] || null,
            operation_type: data.ENTITY_TYPE || null,
            website: data.WEBSITE?.[0] ?? (data.EMAIL?.[0] ? `www.${data.EMAIL[0].split('@')[1]}` : null),
            no_of_employee: data.EMPL || null,
            legal_form: data.STANDARDISED_LEGAL_FORM || null,
            bvd_id: data.BVD_ID_NUMBER || null,
            national_identifier_type: data.NATIONAL_ID_TYPE !== null ? JSON.stringify(data.NATIONAL_ID_TYPE, null, 2) : null,
            national_identifier: data.NATIONAL_ID !== null ? JSON.stringify(data.NATIONAL_ID, null, 2) : null,
            alias: data.AKA_NAME !== null ? JSON.stringify(data.AKA_NAME, null, 2) : null,
            incorporation_date: data.INCORPORATION_DATE || null,
            num_subsidiaries: data.SUB_COUNT || null,
            num_companies_in_corp_grp: data.CORPORATE_GROUP_SIZE_LABEL || null,
            num_direct_shareholders: data.SH_COUNT || null,
            operating_revenue: OPRE || null,
            profit_loss_after_tax: PL || null,
            ebitda: EBTA || null,
            current_ratio: CURR || null,
            roe_using_net_income: ROE || null,
            pr_qualitative_score: data.MODEFINNF || null,
            pr_more_risk_score: data.MORRAT || null,
            pr_reactive_more_risk_score: data.REACMORRAT || null,
            pr_qualitative_score_date: data.MODEFINNFDATE || null,
            pr_more_risk_score_date: data.MORE_YEAR || null,
            pr_reactive_more_risk_score_date: data.REACMORE_DATE || null,
            esg_overall_rating: data.ESG_GLOBAL_SCORE || null,
            esg_environmental_rating: data.ESG_ENV_SCORE || null,
            esg_social_rating: data.ESG_SOC_SCORE || null,
            esg_governance_rating: data.ESG_GOV_SCORE || null,
            esg_date: data.ESG_COMPUTATION_DATE || null,
            cyber_risk_score: data.BITSIGHT_SECURITY_RATING || null,
            cyber_botnet_infection: data.BITSIGHT_VECTOR_BOTNET_INFECTIONS || null,
            cyber_malware_servers: data.BITSIGHT_VECTOR_MALWARE_SERVERS || null,
            cyber_ssl_certificate: data.BITSIGHT_VECTOR_TLS_SSL_CERTIFICATES || null,
            cyber_webpage_headers: data.BITSIGHT_VECTOR_WEB_APPLICATION_HEADERS || null,
            cyber_date: data.BITSIGHT_UPDATED_DATE || null,
            implied_cyber_risk_score: data.IMPLIED_CYBER_THREAT_RISK_METRIC || null,
            implied_cyber_risk_score_date: data.IMPLIED_CYBER_THREAT_DATE || null,
            beneficial_owners: beneficial_owners !== null ? JSON.stringify(beneficial_owners, null, 2) : null,
            global_ultimate_owner: global_ultimate_owner !== null ? JSON.stringify(global_ultimate_owner, null, 2) : null,
            shareholders: shareholders !== null ? JSON.stringify(shareholders, null, 2) : null,
            ultimately_owned_subsidiaries: ultimately_owned_subsidiaries !== null ? JSON.stringify(ultimately_owned_subsidiaries, null, 2) : null,
            other_ultimate_beneficiary: other_ultimate_beneficiary !== null ? JSON.stringify(other_ultimate_beneficiary, null, 2) : null,
            solvency_ratio: SOLR || null,
            roce_before_tax: RCEM || null,
            profit_margin: PRMA || null,
            shareholders_fund: SHFD || null,
            total_assets: TOAS || null,
            cash_flow: CF || null,
            roe_before_tax: RSHF || null,
            pl_before_tax: PLBT || null,
            controlling_shareholders: controlling_shareholders !== null ? JSON.stringify(controlling_shareholders, null, 2) : null,
            Beneficial_owners_intermediatory: beneficial_owners_intermediatory !== null ? JSON.stringify(beneficial_owners_intermediatory, null, 2) : null,
            management: management !== null ? JSON.stringify(management, null, 2) : null,
            global_ultimate_owner_type: data.GUO_ENTITY_TYPE !== null ? JSON.stringify(data.GUO_ENTITY_TYPE, null, 2) : null,
            controlling_shareholders_type: data.CSH_ENTITY_TYPE !== null ? JSON.stringify(data.CSH_ENTITY_TYPE, null, 2) : null,
            pr_more_risk_score_ratio: pr_more_risk_score_ratio !== null ? JSON.stringify(pr_more_risk_score_ratio, null, 2) : null,
            pr_reactive_more_risk_score_ratio: pr_reactive_more_risk_score_ratio !== null ? JSON.stringify(pr_reactive_more_risk_score_ratio, null, 2) : null,
            default_events: default_events.length > 0 ? JSON.stringify(default_events, null, 2) : null,
            long_and_short_term_debt: data.LOAN || null,
            long_term_debt: data.LTDB || null,
            total_shareholders_equity: data["14041"] || null,
            operating_revenue_usd: OPRE_usd || null,
            ens_id: ensId,
            session_id: sessionId
        };

        try {
            const tableName = "external_supplier_data";
            const interted_response = await updatedinsertTable(tableName, response, ensId, sessionId);
            // BUG FIX 6: Check if DB insert actually succeeded before returning 200
            if (!interted_response) {
                return res.status(409).json({ success: false, message: "Failed to save data to database", data: response });
            }
            return res.status(200).json({ success: true, message: "Successfully saved data", data: interted_response });
        } catch (error) {
            return res.status(409).json({ success: false, message: error.message, data: response });
        }

    } catch (error) {
        console.error('Error fetching data from Orbis API:', error);
        return res.status(500).json({ error: 'Internal server error.', details: error.message });
    }
};

export const getGridData = async (req, res) => {

    // Ensure token is valid before making request
    await ensureValidToken();

    const { orgName, sessionId, ensId, city, bvdId, country } = req.query;

    const url = "https://service.rdc.eu.com/api/grid-service/v2/inquiry";
    const action = "post"
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${global.access_token}`,
        "interfaceVersion": "1.2"
    };
    const currentDate = new Date();
    const payload = {
        "portfolioMonitoring": "false",
        "portfolioMonitoringActionIfDuplicate": "REPLACE",
        "searchActionIfDuplicate": "SEARCH_UNLESS_SEARCHED",
        "loadOnly": "false",
        "globalSearch": "false",
        "reporting": sessionId,
        "tracking": ensId+currentDate,
        "gridOrgPartyInfo": {
            "gridOrgData": {
                "orgName": { "name": orgName },
                "gridContact": {
                    "addr": {
                        "city": city,
                        "countryCode": { "countryCodeValue": country }
                    }
                }
            },
            "partyContext": { "note": "" }
        },
        "note": ""
    };

    try {
        let responseData = await makeAuthenticatedRequest(url, payload, headers, action);
        
        if (!responseData) {
            return res.status(500).json({ error: 'API request failed.',adv_count:0 });
        }
        //  Categorize alerts & Process Data
        const categorizedData = processAlerts(responseData.data.alerts, bvdId);
        let isAllNull = Object.values(categorizedData).every(value => value === null);
          if (isAllNull){
                return res.status(200).json({ success: true, message: "No data available", data: false, adv_count:0});
          }
        //  Save Data to Database
        const tableName = "external_supplier_data";
        const crimes = JSON.parse(categorizedData.grid_event_adverse_media_other_crimes || "[]");
        const reputationalRisk = JSON.parse(categorizedData.grid_event_adverse_media_reputational_risk || "[]");

        const count = (Array.isArray(crimes) ? crimes.length : 0) +
                      (Array.isArray(reputationalRisk) ? reputationalRisk.length : 0);

        console.log("grid grid count:",count);
        const updated_response = await updateTable(tableName, categorizedData, ensId, sessionId);

        return res.status(200).json(
            updated_response.success
                ? { success: true, message: "Successfully Updated Information", data: updated_response.data, payload: responseData, adv_count:count }
                : { success: false, message: updated_response.message, data: false, adv_count:0}
        );
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(500).json({success:false, error: 'Internal server error.', details: error.message, data:false, adv_count:0 });
    }
};

const ensureValidToken = async () => {
    if (!global.access_token) {
        console.log(" No token found. Logging in...");
        global.access_token = await OrbisGridLogin();
    }
};

const ensureValidTokenForPortfolio = async () => {
    if (!global.access_token_portfolio) {
        console.log(" No token found. Logging in...");
        global.access_token_portfolio = await PortfolioGridLogin();
    }
};

const makeAuthenticatedRequest = async (url, payload, headers, action) => {
    try {
      if (action.toLowerCase() === "get") {
        const response = await axios.get(url, { headers });
        return response.data;
      } else if (action.toLowerCase() === "post") {
        const response = await axios.post(url, payload, { headers });
        return response.data;
      } else {
        throw new Error("Invalid action. Use 'GET' or 'POST'.");
      }
    } catch (error) {
        if (error.response?.status === 401) {
            console.warn(" Token expired. Refreshing...");
            global.access_token = await OrbisGridLogin();

            if (!global.access_token) throw new Error(" Failed to refresh token");

            headers["Authorization"] = `Bearer ${global.access_token}`;
            if (action.toLowerCase() === 'post') {
              return axios.post(url, payload, { headers }).then(res => res.data);
            } else if (action.toLowerCase() === 'get') {
              return axios.get(url, { payload, headers }).then(res => res.data);
            } else {
              throw new Error("Invalid action type");
            }
        } else {
            console.error(" API request failed:", error.response?.data || error.message);
            throw error;
        }
    }
};

const makeAuthenticatedRequestForPortfolio = async (url, payload, headers, action) => {
    try {
      if (action.toLowerCase() === "get") {
        const response = await axios.get(url, { headers });
        return response.data;
      } else if (action.toLowerCase() === "post") {
        const response = await axios.post(url, payload, { headers });
        return response.data;
      } else {
        throw new Error("Invalid action. Use 'GET' or 'POST'.");
      }
    } catch (error) {
        if (error.response?.status === 401) {
            console.warn(" Token expired. Refreshing...");
            global.access_token_portfolio = await PortfolioGridLogin();

            if (!global.access_token_portfolio) throw new Error(" Failed to refresh token");

            headers["Authorization"] = `Bearer ${global.access_token_portfolio}`;
            if (action.toLowerCase() === 'post') {
              return axios.post(url, payload, { headers }).then(res => res.data);
            } else if (action.toLowerCase() === 'get') {
              return axios.get(url, { payload, headers }).then(res => res.data);
            } else {
              throw new Error("Invalid action type");
            }
        } else {
            console.error(" API request failed:", error.response?.data || error.message);
            throw error;
        }
    }
};

const processAlerts = (alerts, bvdId) => {
    const categories = {
      bcf: ['BRB', 'CFT', 'CON', 'FRD', 'MLA', 'MOR', 'MSB', 'RES', 'TAX'],
      reg: ['FOR', 'SEC'],
      san: ['FOF', 'FOS', 'IRC', 'SNX', 'DEN', 'FAR','REG'],
      pep: ['PEP'],
      amr: ['BKY', 'BUS', 'CPR', 'DPP', 'HTE', 'IPR', 'LMD', 'LNS', 'MIS', 'VCY'],
      amo: ['WLT', 'ABU', 'ARS', 'AST', 'BUR', 'CYB', 'DPS', 'DTF', 'ENV', 'FUG', 'GAM', 'HUM', 'IGN', 'IMP', 'KID', 'MUR', 'NSC', 'OBS', 'ORG', 'PRJ', 'ROB', 'SEX', 'SMG', 'SPY', 'TER', 'TFT', 'TRF'],
      legal: ['ACC', 'ACQ', 'APL', 'ARB', 'ARN', 'ART', 'CHG', 'CMP', 'CNF', 'CSP', 'CVT', 'DEP', 'DMS', 'FIL', 'FIM', 'IND', 'LIN', 'PLE', 'SET', 'SEZ', 'SJT', 'SPD', 'TRL', 'WTD']
    };

    const categorizedData = {
        event_sanctions: [],
        event_regulatory: [],
        event_bribery_fraud_corruption: [],
        event_pep: [],
        event_adverse_media_other_crimes: [],
        event_adverse_media_reputational_risk: [],
        legal: []
    };

    alerts.forEach(alert => {
        const nonReviewedAlerts = alert.gridAlertInfo.alerts.nonReviewedAlertEntity;

        // 1. Try to find a match with the given bvdId
        let alertEntity = nonReviewedAlerts.find(
            item => item.identification?.some(
                idObj => idObj.idType === "BvD ID" && idObj.idNumber === bvdId
            )
        );


        // 2. If no exact match, find the first entity with matchScore >= 90
        if (!alertEntity) {
            console.log("checking for highest match score above 90");
            alertEntity = nonReviewedAlerts.reduce((max, item) =>
                (item.matchScore !== undefined && item.matchScore > 95 &&
                (max === null || item.matchScore > max.matchScore)) ? item : max, null
            );
        }

        // 3. If still no match, return without processing
        if (!alertEntity) return;

        alertEntity.event.forEach(event => {
            const entityData = {
                entityName: alertEntity.entityName,
                matchScore: alertEntity.matchScore,
                eventCategory: event.category?.categoryCode || "No category code available",
                eventCategoryDesc: event.category?.categoryDesc || "No category description available",
                eventDate: event.eventDt || "No event date available",
                eventDesc: event.eventDesc || "No event description available",
                eventSubCategory: event.subCategory?.categoryCode || "No subcategory code available",
                eventSubCategoryDesc: event.subCategory?.categoryDesc || "No subcategory description available",
                eventSourceURL: event.source?.sourceURL || "No source URL available",
                eventHeadline: event.source?.headline || "No headline available",
                eventSourceEntityDate: event.source?.entityDt || "No entity date available",
                legalFlag: categories.legal.includes(event.subCategory?.categoryCode)
            };

            if (categories.bcf.includes(entityData.eventCategory)) categorizedData.event_bribery_fraud_corruption.push(entityData);
            else if (categories.reg.includes(entityData.eventCategory)) categorizedData.event_regulatory.push(entityData);
            else if (categories.san.includes(entityData.eventCategory)) categorizedData.event_sanctions.push(entityData);
            else if (categories.amo.includes(entityData.eventCategory)) categorizedData.event_adverse_media_other_crimes.push(entityData);
            else if (categories.amr.includes(entityData.eventCategory)) categorizedData.event_adverse_media_reputational_risk.push(entityData);
            else if (categories.pep.includes(entityData.eventCategory)) categorizedData.event_pep.push(entityData);

            if (entityData.legalFlag) categorizedData.legal.push(entityData);
        });
    });

    return {
      grid_event_sanctions: categorizedData.event_sanctions.length > 0 ? JSON.stringify(categorizedData.event_sanctions, null, 2) : null,
      grid_event_regulatory: categorizedData.event_regulatory.length > 0 ? JSON.stringify(categorizedData.event_regulatory, null, 2) : null,
      grid_event_bribery_fraud_corruption: categorizedData.event_bribery_fraud_corruption.length > 0 ? JSON.stringify(categorizedData.event_bribery_fraud_corruption, null, 2) : null,
      grid_event_pep: categorizedData.event_pep.length > 0 ? JSON.stringify(categorizedData.event_pep, null, 2) : null,
      grid_event_adverse_media_other_crimes:  categorizedData.event_adverse_media_other_crimes.length > 0 ? JSON.stringify( categorizedData.event_adverse_media_other_crimes, null, 2) : null,
      grid_event_adverse_media_reputational_risk: categorizedData.event_adverse_media_reputational_risk.length > 0 ? JSON.stringify(categorizedData.event_adverse_media_reputational_risk, null, 2) : null,
      grid_legal: categorizedData.legal.length > 0 ? JSON.stringify(categorizedData.legal, null, 2) : null                
  };
};


export const getOrbisGridData = async (req, res) => {
    const { sessionId, ensId, bvdId} = req.query;
  
    if (!sessionId || !ensId ||!bvdId) {
        return res.status(400).json({success:false, error: 'Missing required query parameters: orgName, reportingId, trackingId, city', data:false, adv_count:0 });
    }
  
    const endpoint = `https://api.bvdinfo.com/v1/orbis/gridreview/data`;

    const bcf = ['BRB', 'CFT', 'CON', 'FRD', 'MLA', 'MOR', 'MSB', 'RES', 'TAX']
    const reg = ['FOR', 'SEC']
    const san = ['FOF', 'FOS', 'IRC', 'SNX', 'DEN', 'FAR','REG']
    const pep = ['PEP']
    const amr = ['BKY', 'BUS', 'CPR', 'DPP', 'HTE', 'IPR', 'LMD', 'LNS', 'MIS', 'VCY']
    const amo = ['WLT','ABU', 'ARS', 'AST', 'BUR', 'CYB', 'DPS', 'DTF', 'ENV', 'FUG', 'GAM', 'HUM', 'IGN', 'IMP', 'KID', 'MUR', 'NSC', 'OBS', 'ORG', 'PRJ', 'ROB', 'SEX', 'SMG', 'SPY', 'TER', 'TFT', 'TRF']
    const legal = ['ACC', 'ACQ', 'APL', 'ARB', 'ARN', 'ART', 'CHG', 'CMP', 'CNF', 'CSP', 'CVT', 'DEP', 'DMS', 'FIL', 'FIM', 'IND', 'LIN', 'PLE', 'SET', 'SEZ', 'SJT', 'SPD', 'TRL', 'WTD']

    const headers = {
        'Content-Type': 'application/json',
        'ApiToken': '45U38110c76ac84342928687c6edb0687fa0'
    };

    const query = {"WHERE": [{"BvDID": bvdId}],"SELECT": ["REPORT"]}
    try {
        const responseData = await axios.get(endpoint, { 
            params: { QUERY: JSON.stringify(query) }, 
            headers: headers
        });
        // console.log(responseData.data.Data[0].Grid_Events)
        // const responseData = matchgridresponse;
        let bcfList= []
        let regList= []
        let sanList= []
        let pepList= []
        let amrList= []
        let amoList= []
        let legalList = []
  
        if (responseData) {
            // console.log("response", responseData.data.Data[0])

            const gridEvents = responseData?.data?.Data?.[0]?.Grid_Events;

            if (Array.isArray(gridEvents) && gridEvents.length > 0) {
                gridEvents.forEach(event => {
                    try {
            // Extracting relevant event details safely
                        const eventData = {
                            "eventDate": event.Grid_Event_Date || "No Date",
                            "eventCategory": event.Grid_Event_Category?.Grid_Event_Category_Code || "No category code available",
                            "eventCategoryDesc": event.Grid_Event_Category?.Grid_Event_Category_Description || "No category description available",
                            "eventSubCategory": event.Grid_Event_SubCategory?.Grid_Event_Category_Code || "No subcategory code available",
                            "eventSubCategoryDesc": event.Grid_Event_SubCategory?.Grid_Event_Category_Description || "No subcategory description available",
                            "eventDesc": event.Grid_Entity_Description || "No event date available"
                        };

                        if (amr.includes(eventData.eventCategory)) amrList.push(eventData);
                        else if (san.includes(eventData.eventCategory)) sanList.push(eventData);
                        else if (bcf.includes(eventData.eventCategory)) bcfList.push(eventData);
                        else if (reg.includes(eventData.eventCategory)) regList.push(eventData);
                        else if (amo.includes(eventData.eventCategory)) amoList.push(eventData);
                        else if (pep.includes(eventData.eventCategory)) pepList.push(eventData);

            // Check for Legal Flag
                        if (legal.includes(eventData.eventSubCategory)) legalList.push(eventData);

                    } catch (error) {
                        console.error("Error processing event:", error);
                    }
                });
            }
            try {
              let response = {
                event_sanctions: sanList.length > 0 ? JSON.stringify(sanList, null, 2) : null,
                event_regulatory: regList.length > 0 ? JSON.stringify(regList, null, 2) : null,
                event_bribery_fraud_corruption: bcfList.length > 0 ? JSON.stringify(bcfList, null, 2) : null,
                event_pep: pepList.length > 0 ? JSON.stringify(pepList, null, 2) : null,
                event_adverse_media_other_crimes: amoList.length > 0 ? JSON.stringify(amoList, null, 2) : null,
                event_adverse_media_reputational_risk: amrList.length > 0 ? JSON.stringify(amrList, null, 2) : null,
                legal: legalList.length > 0 ? JSON.stringify(legalList, null, 2) : null
              };
              let isAllNull = Object.values(response).every(value => value === null);
              if (isAllNull){
                    return res.status(200).json({ success: true, message: "No data available", data: false, adv_count:0});
              }
                const tableName = "external_supplier_data";
                const crimes = JSON.parse(response.event_adverse_media_other_crimes || "[]");
                const reputationalRisk = JSON.parse(response.event_adverse_media_reputational_risk || "[]");

                const count = (Array.isArray(crimes) ? crimes.length : 0) +
                              (Array.isArray(reputationalRisk) ? reputationalRisk.length : 0);

//                console.log("orbis grid count:",count);
                const updated_response = await updateTable(tableName, response, ensId, sessionId);
                return res.status(200).json({ success: true, message: "Successfully Updated Information", data: updated_response.data, adv_count:count });
            } catch (error) {
                return res.status(409).json({ success: false,  message: error.message, data: false, adv_count:0});
            }
        } else {
            return res.status(409).json({success: false, error: 'API request failed.', data: false, adv_count:0 });
        }
    } catch (error) {
        console.error('Error fetching data from Orbis API:', error);
        return res.status(500).json({success: false, error: 'Internal server error.', message:"couldnt fetch data", data:false, adv_count:0 });
    }
  };


  export const getGridDataPersonnels = async (req, res) => {
    console.log("----Start Grid Personnel----")
    // Ensure token is valid before making request
    await ensureValidToken();

    const { personnelName, sessionId, ensId, contactId, country, city, managementInfo } = req.body;


    const url = "https://service.rdc.eu.com/api/grid-service/v2/inquiry";

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${global.access_token}`,
        "interfaceVersion": "1.2"
    };
    const action = "post"
    const currentDate = new Date();
    const payload = {
        "portfolioMonitoring":"false",
        "portfolioMonitoringActionIfDuplicate":"REPLACE",
        "searchActionIfDuplicate":"SEARCH_UNLESS_SEARCHED",
        "loadOnly":"false",
        "globalSearch":"false",
        "reporting":sessionId,
        "tracking":ensId+contactId+currentDate,
        "gridPersonPartyInfo":{
           "gridPersonData":{
              "personName":{
                 "fullName":personnelName
              },
              "gridContact":{
                 "addr":{
                    "addr1":"",
                    "city":city | "",
                    "stateProv":"",
                    "postalCode":"",
                    "countryCode":{
                       "countryCodeValue":country
                    }
                 }
              }
           },
           "partyContext":{
              "note":""
           },
           "birthDt": "",
           "sex":""
        },
        "note":""
     };

    try {
        let responseData = await makeAuthenticatedRequest(url, payload, headers, action);
        if (!responseData) {
          console.log("----Error Grid Personnel: API Failed----")
            return res.status(500).json({ success: false, data: false, error: 'API request failed.', adv_count:0 });
        }
        //  Categorize alerts & Process Data
        
        // const categorizedData = processAlerts(responseData.data.alerts, bvdId);
        const categories = {
          bcf: ['BRB', 'CFT', 'CON', 'FRD', 'MLA', 'MOR', 'MSB', 'RES', 'TAX'],
          reg: ['FOR', 'SEC'],
          san: ['FOF', 'FOS', 'IRC', 'SNX', 'DEN', 'FAR','REG'],
          pep: ['PEP'],
          amr: ['BKY', 'BUS', 'CPR', 'DPP', 'HTE', 'IPR', 'LMD', 'LNS', 'MIS', 'VCY'],
          amo: ['WLT','ABU', 'ARS', 'AST', 'BUR', 'CYB', 'DPS', 'DTF', 'ENV', 'FUG', 'GAM', 'HUM', 'IGN', 'IMP', 'KID', 'MUR', 'NSC', 'OBS', 'ORG', 'PRJ', 'ROB', 'SEX', 'SMG', 'SPY', 'TER', 'TFT', 'TRF'],
          legal: ['ACC', 'ACQ', 'APL', 'ARB', 'ARN', 'ART', 'CHG', 'CMP', 'CNF', 'CSP', 'CVT', 'DEP', 'DMS', 'FIL', 'FIM', 'IND', 'LIN', 'PLE', 'SET', 'SEZ', 'SJT', 'SPD', 'TRL', 'WTD']
        };
        let categorizedData = {
          event_sanctions: [],
          event_regulatory: [],
          event_bribery_fraud_corruption: [],
          event_pep: [],
          event_adverse_media_other_crimes: [],
          event_adverse_media_reputational_risk: [],
          legal: []
        };
        if (responseData.data.reviewStatus === 'NOMATCH'){  
          console.log("----Grid Personnel: No Match----")
          return res.status(200).json({ success: true, data: "No Match found", adv_count:0 });}
        
        if (responseData.data.reviewStatus === 'LOAD') {
          console.log("----Grid Personnel: Track Id Not Unique----")
          return res.status(409).json({ success: false, data: "Tracking ID already in use", adv_count:0 });}
        
        let alerts=responseData.data.alerts
        console.log(responseData.data.reviewStatus)
        alerts.forEach(alert => {
          const nonReviewedAlerts = alert.gridAlertInfo.alerts.nonReviewedAlertEntity;
      
//          const alertEntity = nonReviewedAlerts.length > 0 && nonReviewedAlerts[0].matchScore >= 90
//                  ? nonReviewedAlerts[0]
//                  : null; // Take the first alert
            // Filter non-reviewed alerts to only those with match score >= 96
          const validAlerts = nonReviewedAlerts.filter(alert => alert.matchScore >= 96);
          // From the valid alerts, find the one with the highest match score
          // If none found, assign null
          const alertEntity = validAlerts.length > 0 ? validAlerts.reduce((max, current) => current.matchScore > max.matchScore ? current : max) : null;
          console.log('no of grid alert(personnel):', alertEntity ? Object.keys(alertEntity).length : 0);

          if (alertEntity) {
              alertEntity.event.forEach(event => {
                  const entityData = {
                      entityName: alertEntity.entityName,
                      matchScore: alertEntity.matchScore,
                      eventCategory: event.category?.categoryCode || "No category code available",
                      eventCategoryDesc: event.category?.categoryDesc || "No category description available",
                      eventDate: event.eventDt || "No event date available",
                      eventDesc: event.eventDesc || "No event description available",
                      eventSubCategory: event.subCategory?.categoryCode || "No subcategory code available",
                      eventSubCategoryDesc: event.subCategory?.categoryDesc || "No subcategory description available",
                      eventSourceURL: event.source?.sourceURL || "No source URL available",
                      eventHeadline: event.source?.headline || "No headline available",
                      eventSourceEntityDate: event.source?.entityDt || "No entity date available",
                      legalFlag: categories.legal.includes(event.subCategory?.categoryCode)
                  };
                  if (categories.bcf.includes(entityData.eventCategory)) categorizedData.event_bribery_fraud_corruption.push(entityData);
                  else if (categories.reg.includes(entityData.eventCategory)) categorizedData.event_regulatory.push(entityData);
                  else if (categories.san.includes(entityData.eventCategory)) categorizedData.event_sanctions.push(entityData);
                  else if (categories.amo.includes(entityData.eventCategory)) categorizedData.event_adverse_media_other_crimes.push(entityData);
                  else if (categories.amr.includes(entityData.eventCategory)) categorizedData.event_adverse_media_reputational_risk.push(entityData);
                  else if (categories.pep.includes(entityData.eventCategory)) categorizedData.event_pep.push(entityData);
      
                  if (entityData.legalFlag) categorizedData.legal.push(entityData);
              });
          }
        });
        try {
          const grid_sanctions= categorizedData.event_sanctions.length > 0 ? JSON.stringify(categorizedData.event_sanctions, null, 2) : null;
          const grid_regulatory= categorizedData.event_regulatory.length > 0 ? JSON.stringify(categorizedData.event_regulatory, null, 2) : null;
          const grid_bribery_fraud_corruption= categorizedData.event_bribery_fraud_corruption.length > 0 ? JSON.stringify(categorizedData.event_bribery_fraud_corruption, null, 2) : null;
          const grid_pep= categorizedData.event_pep.length > 0 ? JSON.stringify(categorizedData.event_pep, null, 2) : null;
          const grid_adverse_media_other_crimes=  categorizedData.event_adverse_media_other_crimes.length > 0 ? JSON.stringify( categorizedData.event_adverse_media_other_crimes, null, 2) : null;
          const grid_adverse_media_reputational_risk= categorizedData.event_adverse_media_reputational_risk.length > 0 ? JSON.stringify(categorizedData.event_adverse_media_reputational_risk, null, 2) : null;
          const grid_legal= categorizedData.legal.length > 0 ? JSON.stringify(categorizedData.legal, null, 2) : null;
          const result = await pool.query(
            `INSERT INTO grid_management (
              ens_id,
              contact_id,
              session_id,
              grid_sanctions,
              grid_regulatory,
              grid_bribery_fraud_corruption,
              grid_pep,
              grid_adverse_media_other_crimes,
              grid_adverse_media_reputational_risk,
              management_info,
              grid_legal
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            ON CONFLICT (ens_id, contact_id, session_id) 
            DO UPDATE SET 
              grid_sanctions = EXCLUDED.grid_sanctions,
              grid_regulatory = EXCLUDED.grid_regulatory,
              grid_bribery_fraud_corruption = EXCLUDED.grid_bribery_fraud_corruption,
              grid_pep = EXCLUDED.grid_pep,
              grid_adverse_media_other_crimes = EXCLUDED.grid_adverse_media_other_crimes,
              grid_adverse_media_reputational_risk = EXCLUDED.grid_adverse_media_reputational_risk,
              grid_legal = EXCLUDED.grid_legal,
              management_info = EXCLUDED.management_info,
              update_time = NOW()
            RETURNING *;`,
            [ensId, contactId, sessionId, grid_sanctions, grid_regulatory, grid_bribery_fraud_corruption, grid_pep, grid_adverse_media_other_crimes, grid_adverse_media_reputational_risk, managementInfo, grid_legal]
          );
//          console.log("result:",result)
          const crimes = JSON.parse(grid_adverse_media_other_crimes || "[]");
          const reputationalRisk = JSON.parse(grid_adverse_media_reputational_risk || "[]");

          const count = (Array.isArray(crimes) ? crimes.length : 0) +
                        (Array.isArray(reputationalRisk) ? reputationalRisk.length : 0);
          console.log("----Ended Grid Personnel----")
          return res.status(200).json({ success: true, message: "Successfully saved data", data: result.rows, adv_count:count});
        } catch (error) {
            console.log("----Error(409) Grid Personnel:----", error)
//            console.error(' Error fetching data:', error);
          return res.status(409).json({ success: false,  message: error.message, data: "couldnt save data", adv_count:0});
        }
    } catch (error) {
        console.log("----Error(500) Grid Personnel:----", error)
//        console.error(' Error fetching data:', error);
        return res.status(500).json({ error: 'Internal server error.', details: error.message, adv_count:0 });
    }
};


export const getGridDataOrganizationWithId = async (req, res) => {

  // Ensure token is valid before making request
  await ensureValidToken();

  const { sessionId, ensId, bvdId} = req.query;

  if (!sessionId || !ensId|| !bvdId) {
      return res.status(400).json({ success: false, data: false,error: 'Missing required query parameters.', adv_count:0 });
  }

  const url = "https://service.rdc.eu.com/api/grid-service/v2/id-lookup/id-types/115/grid-entities";
  const action="get"
  const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${global.access_token}`,
      "interfaceVersion": "1.2"
  };
  const queryString = new URLSearchParams({
    'id-value': bvdId,
    'entity-type': 'O'
  }).toString();
  const fullUrl = `${url}?${queryString}`;

  try {
      let responseData = await makeAuthenticatedRequest(fullUrl, queryString, headers, action);
      if (!responseData) {
          return res.status(500).json({ success: false ,message: "API request failed", error: "API request failed", data: false, adv_count:0});
      }
      if (!responseData.gridEntityRec[0]){
        return res.status(200).json({ success: true, message: 'No event for the particular entity', data: false, adv_count:0 });
      }

      const categorizedData = categorization(responseData.gridEntityRec[0].gridEntityInfo.gridEntity, bvdId);
       let isAllNull = Object.values(categorizedData).every(value => value === null);
         if (isAllNull){
               return res.status(200).json({ success: true, message: "No data available", data: false, adv_count:0});
         }
      //  Save Data to Database
      const tableName = "external_supplier_data";
      const crimes = JSON.parse(categorizedData.grid_event_adverse_media_other_crimes || "[]");
      const reputationalRisk = JSON.parse(categorizedData.grid_event_adverse_media_reputational_risk || "[]");

      const count = (Array.isArray(crimes) ? crimes.length : 0) +
                   (Array.isArray(reputationalRisk) ? reputationalRisk.length : 0);

//     console.log("get grid id",count);
     const updated_response = await updateTable(tableName, categorizedData, ensId, sessionId);

      return res.status(200).json(
          updated_response.success
              ? { success: true, message: "Successfully Updated Information", data: updated_response.data, adv_count:count }
              : { success: false, message: updated_response.message, data: updated_response.data }
      );
  } catch (error) {
      console.error(' Error fetching data:', error);
      return res.status(500).json({ success: true, error: 'Internal server error.', details: error.message, data: false});
  }
};


const categorization = (alertEntity) => {

  const categories = {
    bcf: ['BRB', 'CFT', 'CON', 'FRD', 'MLA', 'MOR', 'MSB', 'RES', 'TAX'],
    reg: ['FOR', 'SEC'],
    san: ['FOF', 'FOS', 'IRC', 'SNX', 'DEN', 'FAR','REG'],
    pep: ['PEP'],
    amr: ['BKY', 'BUS', 'CPR', 'DPP', 'HTE', 'IPR', 'LMD', 'LNS', 'MIS', 'VCY'],
    amo: ['WLT','ABU', 'ARS', 'AST', 'BUR', 'CYB', 'DPS', 'DTF', 'ENV', 'FUG', 'GAM', 'HUM', 'IGN', 'IMP', 'KID', 'MUR', 'NSC', 'OBS', 'ORG', 'PRJ', 'ROB', 'SEX', 'SMG', 'SPY', 'TER', 'TFT', 'TRF'],
    legal: ['ACC', 'ACQ', 'APL', 'ARB', 'ARN', 'ART', 'CHG', 'CMP', 'CNF', 'CSP', 'CVT', 'DEP', 'DMS', 'FIL', 'FIM', 'IND', 'LIN', 'PLE', 'SET', 'SEZ', 'SJT', 'SPD', 'TRL', 'WTD']
  };

  const categorizedData = {
    event_sanctions: [],
    event_regulatory: [],
    event_bribery_fraud_corruption: [],
    event_pep: [],
    event_adverse_media_other_crimes: [],
    event_adverse_media_reputational_risk: [],
    legal: []
  };
  alertEntity.event.forEach(event => {
    const entityData = {
        entityName: alertEntity.entityName,
        matchScore: alertEntity.matchScore,
        eventCategory: event.category?.categoryCode || "No category code available",
        eventCategoryDesc: event.category?.categoryDesc || "No category description available",
        eventDate: event.eventDt || "No event date available",
        eventDesc: event.eventDesc || "No event description available",
        eventSubCategory: event.subCategory?.categoryCode || "No subcategory code available",
        eventSubCategoryDesc: event.subCategory?.categoryDesc || "No subcategory description available",
        eventSourceURL: event.source?.sourceURL || "No source URL available",
        eventHeadline: event.source?.headline || "No headline available",
        eventSourceEntityDate: event.source?.entityDt || "No entity date available",
        legalFlag: categories.legal.includes(event.subCategory?.categoryCode)
    };

    if (categories.bcf.includes(entityData.eventCategory)) categorizedData.event_bribery_fraud_corruption.push(entityData);
    else if (categories.amr.includes(entityData.eventCategory)) categorizedData.event_adverse_media_reputational_risk.push(entityData);
    else if (categories.san.includes(entityData.eventCategory)) categorizedData.event_sanctions.push(entityData);
    else if (categories.pep.includes(entityData.eventCategory)) categorizedData.event_pep.push(entityData);
    else if (categories.amo.includes(entityData.eventCategory)) categorizedData.event_adverse_media_other_crimes.push(entityData);
    else if (categories.reg.includes(entityData.eventCategory)) categorizedData.event_regulatory.push(entityData);

    if (entityData.legalFlag) categorizedData.legal.push(entityData);
  });

  return {
    grid_event_sanctions: categorizedData.event_sanctions.length > 0 ? JSON.stringify(categorizedData.event_sanctions, null, 2) : null,
    grid_event_regulatory: categorizedData.event_regulatory.length > 0 ? JSON.stringify(categorizedData.event_regulatory, null, 2) : null,
    grid_event_bribery_fraud_corruption: categorizedData.event_bribery_fraud_corruption.length > 0 ? JSON.stringify(categorizedData.event_bribery_fraud_corruption, null, 2) : null,
    grid_event_pep: categorizedData.event_pep.length > 0 ? JSON.stringify(categorizedData.event_pep, null, 2) : null,
    grid_event_adverse_media_other_crimes:  categorizedData.event_adverse_media_other_crimes.length > 0 ? JSON.stringify( categorizedData.event_adverse_media_other_crimes, null, 2) : null,
    grid_event_adverse_media_reputational_risk: categorizedData.event_adverse_media_reputational_risk.length > 0 ? JSON.stringify(categorizedData.event_adverse_media_reputational_risk, null, 2) : null,
    grid_legal: categorizedData.legal.length > 0 ? JSON.stringify(categorizedData.legal, null, 2) : null
              
};
};



export const getGridDataPersonnelWithId = async (req, res) => {

  // Ensure token is valid before making request
  await ensureValidToken();

  const { sessionId, ensId, bvdId} = req.query;

  if (!sessionId || !ensId|| !bvdId) {
      return res.status(400).json({ error: 'Missing required query parameters.' });
  }
  let contactId=bvdId
  // change the code
  const url = "https://service.rdc.eu.com/api/grid-service/v2/id-lookup/id-types/115/grid-entities";
  const action="get"
  const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${global.access_token}`,
      "interfaceVersion": "1.2"
  };
  const queryString = new URLSearchParams({
    'id-value': contactId,
    'entity-type': 'P'
  }).toString();
  const fullUrl = `${url}?${queryString}`;

  try {
      let responseData = await makeAuthenticatedRequest(fullUrl, queryString, headers, action);
      if (!responseData) {
          return res.status(500).json({success: false, error: 'API request failed.', data: false });
      }
      if (!responseData.gridEntityRec[0]){
        return res.status(200).json({ success: true, message: 'No event for the particular entity', data:false });
      }

      const categorizedData = categorization(responseData.gridEntityRec[0].gridEntityInfo.gridEntity, bvdId);

      //  Save Data to Database
      const tableName = "management";
      const updated_response = await updateTable(tableName, categorizedData, ensId, sessionId);

      return res.status(200).json(
          updated_response.success
              ? { success: true, message: "Successfully Updated Information", data: updated_response.data }
              : { success: false, message: updated_response.message, data: updated_response.data }
      );
  } catch (error) {
      console.error(' Error fetching data:', error);
      return res.status(500).json({ error: 'Internal server error.', details: error.message });
  }
};


export const getOrbisNews = async (req, res) => {
    const { bvdId, sessionId, ensId} = req.query;

    const endpoint = "https://api.bvdinfo.com/v1/orbis/news/data";
    const date = new Date().toISOString().split("T")[0];
//    console.log("date:", date)
    const query = {
        "WHERE": [
            {"BvDID": [bvdId]},
            {"SentimentsScore": ["Negative"]},
            {"Date": {"from": "2020-01-01", "to": date}}
        ],
        "SELECT": [
            "TITLE",
            "DATE",
            "ARTICLE",
            "QUOTED_COMPANY_NAME",
            "TOPIC",
            "SOURCE",
            "PUBLICATION"
        ],
        "ORDERBY":{"DESC": "DATE"}
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'ApiToken': '45U38110c76ac84342928687c6edb0687fa0'
        };

        const response1 = await axios.get(endpoint, {
            params: { QUERY: JSON.stringify(query) },
            headers: headers
        });



        // const response = matchcompaniesresponse;
//        var langdetect = require('langdetect');
        if (response1.status === 200) {
            const data = response1.data.Data
//            console.log("length of article:", data.length, data)
            let formattedResponse = Array.isArray(data) && data.length > 0
                ? JSON.stringify(
                    data
                        .filter(item => item.DATE && item.ARTICLE) // Ensure DATE and ARTICLE exist
                        .map(item => ({
                            ...item,
                            ARTICLE: item.ARTICLE.replace(/<[^>]*>/g, '') // Remove HTML early
                        }))
                        .filter(item => {
                            try {
                                const lang = langdetect.detectOne(item.ARTICLE);
                                return lang === 'en';
                            } catch (error) {
                                console.warn('Language detection failed:', error);
                                return false;
                            }
                        })
                        .sort((a, b) => new Date(b.DATE) - new Date(a.DATE)) // Sort by Date descending
                        .slice(0, 20), // Limit to top 20
                    null,
                    2 // Pretty-print JSON
                )
                : null;
              console.log("No of articles:", formattedResponse ? JSON.parse(formattedResponse).length : 0);
//              console.log("Articles:", formattedResponse ? JSON.parse(formattedResponse) : null);
            let response = {
                            orbis_news: formattedResponse || null
                          };
            const tableName = "external_supplier_data";
            const interted_response = await updateTable(tableName, response, ensId, sessionId);
            return res.status(200).json({ success: true, message: "Successfully saved data", data: interted_response});
        } else {
            return res.status(409).json({success: true, error: 'API request failed.', details: response1.data, data: false });
        }
    } catch (error) {
        console.error('Error fetching data from Orbis API:', error);
        return res.status(500).json({success: false, error: 'Internal server error.', data:false });
    }
  };

export const setPortfolioMonitoringOrganization = async (req, res) => {

    const { name, primaryId, country, city} = req.query;
    if (await doesDataExist(primaryId)) {
      return res.status(200).json({ success: true, message: "trackingId already exist" });
    }
    // Ensure token is valid before making request
    await ensureValidTokenForPortfolio();
    const currentDate = new Date();
    const reportingId = 'continousMonitoring'
    const trackingId = `Org_${primaryId}`+getRandomUnderscore3();

    const url = "https://service.rdc.eu.com/api/grid-service/v2/inquiry";
    const action = "post"
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${global.access_token_portfolio}`,
        "interfaceVersion": "1.2"
    };
    const payload = {
        "portfolioMonitoring": "true",
        "portfolioMonitoringActionIfDuplicate": "REPLACE",
        "searchActionIfDuplicate": "SEARCH_UNLESS_SEARCHED",
        "loadOnly": "false",
        "globalSearch": "false",
        "reporting": reportingId,
        "tracking": trackingId,
        "gridOrgPartyInfo": {
            "gridOrgData": {
                "orgName": { "name": name },
                "gridContact": {
                    "addr": {
                        "city": city,
                        "countryCode": { "countryCodeValue": country }
                    }
                }
            },
            "partyContext": { "note": "" }
        },
        "note": ""
    };

    try {
        let responseData = await makeAuthenticatedRequestForPortfolio(url, payload, headers, action);

        if (!responseData) {
            return res.status(500).json({ error: 'API request failed.',adv_count:0 });
        }
        //  Categorize alerts & Process Data
        let inquiryId;
        if (responseData.data.reviewStatus == 'NOMATCH'){
            inquiryId = 'no_match'
//                    return res.status(201).json({ success: true, message: "No Match", data: 'NO MATCH', payload: responseData });
        }
        else{
            const inquiryId = responseData.data.alerts[0].gridAlertInfo.gridInquiryRec.gridInquiryId;
        }
        let categorizedData = {
            primary_id: primaryId,
            grid_tracking_id: trackingId,
            grid_enquiry_id: inquiryId,
            category: "organization",
            name: name
        }
        //  Save Data to Database
        const tableName = "grid_pm_tracking";
        const updated_response = await updatedinsertTable2(tableName, categorizedData, primaryId);

        return res.status(200).json(
            updated_response.success
                ? { success: true, message: "Successfully Portfolio Monitor set", data: updated_response.data, payload: responseData }
                : { success: false, message: updated_response.message, data: false, adv_count:0}
        );
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(500).json({success:false, error: 'Internal server error.', details: error.message, data:false});
    }
};


  export const setPortfolioMonitoringPersonnel = async (req, res) => {

    const { name, primaryId, country, city} = req.query;
    if (await doesDataExist(primaryId)) {
          return res.status(200).json({ success: true, message: "trackingId already exist" });
    }
    // Ensure token is valid before making request
    await ensureValidTokenForPortfolio();

    const currentDate = new Date();
    const reportingId = 'continousMonitoring'
    const trackingId = `Mng_${primaryId}`+getRandomUnderscore3();
    const url = "https://service.rdc.eu.com/api/grid-service/v2/inquiry";

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${global.access_token_portfolio}`,
        "interfaceVersion": "1.2"
    };
    const action = "post"
    const payload = {
        "portfolioMonitoring":"true",
        "portfolioMonitoringActionIfDuplicate":"REPLACE",
        "searchActionIfDuplicate":"SEARCH_UNLESS_SEARCHED",
        "loadOnly":"false",
        "globalSearch":"false",
        "reporting":reportingId,
        "tracking":trackingId,
        "gridPersonPartyInfo":{
           "gridPersonData":{
              "personName":{
                 "fullName":name
              },
              "gridContact":{
                 "addr":{
                    "addr1":"",
                    "city":city | "",
                    "stateProv":"",
                    "postalCode":"",
                    "countryCode":{
                       "countryCodeValue":country
                    }
                 }
              }
           },
           "partyContext":{
              "note":""
           },
           "birthDt": "",
           "sex":""
        },
        "note":""
     };

    try {
        let responseData = await makeAuthenticatedRequestForPortfolio(url, payload, headers, action);
        console.log("request completed")
        if (!responseData) {
          console.log("error API failed")
            return res.status(500).json({ success: false, data: false, error: 'API request failed.', adv_count:0 });
        }
        console.log(responseData.data)
        let inquiryId;
        if (responseData.data.reviewStatus == 'NOMATCH'){
            inquiryId = 'no_match'
//            return res.status(201).json({ success: true, message: "No Match", data: 'NO MATCH', payload: responseData });
        }
        else{
            inquiryId = responseData.data.alerts[0].gridAlertInfo.gridInquiryRec.gridInquiryId;
        }
        let categorizedData = {
            primary_id: primaryId,
            grid_tracking_id: trackingId,
            grid_enquiry_id: inquiryId,
            category: "management",
            name: name
        }
        console.log('category', categorizedData)
        //  Save Data to Database
        console.log(categorizedData.name)
        const tableName = "grid_pm_tracking";
        const updated_response = await updatedinsertTable2(tableName, categorizedData, primaryId);

        return res.status(200).json(
            updated_response.success
                ? { success: true, message: "Successfully Portfolio Monitor set", data: updated_response.data, payload: responseData }
                : { success: false, message: updated_response.message, data: false, adv_count:0}
        );

    } catch (error) {
        console.error(' Error fetching data:', error);
        return res.status(500).json({ error: 'Internal server error.', details: error.message, adv_count:0 });
    }
};

function getRandomUnderscore3() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomPart = '';
  for (let i = 0; i < 3; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return '_' + randomPart;
}


