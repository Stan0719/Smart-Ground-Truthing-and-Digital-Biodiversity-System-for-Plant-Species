"use strict";
function finalRejection() {
  throw Object.assign(Error("Rejected is final. This submission cannot be edited or resubmitted."),
    { status: 409, code: "SUBMISSION_REJECTED" });
}
module.exports = { finalRejection };
