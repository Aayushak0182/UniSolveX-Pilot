const { requestListener } = require("../server")

module.exports = (req, res) => requestListener(req, res)
