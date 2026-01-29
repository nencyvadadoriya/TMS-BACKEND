const express = require('express')
const route = express.Router();

route.use("/auth", require("./auth/auth.route"))
route.use("/task", require("./Task/task"))
route.use("/google", require("./google.route"))
route.use("/brands", require("./brand.route"))
route.use("/companies", require("./company.route"))
route.use("/task-types", require("./taskType.route"))
route.use("/company-brand-task-types", require("./companyBrandTaskType.route"))
route.use("/company-task-types", require("./companyTaskType.route"))
route.use("/assign", require("./assign.route"))
route.use("/access", require("./access.route"))

module.exports = route;