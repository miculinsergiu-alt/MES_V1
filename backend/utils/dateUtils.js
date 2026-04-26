function addMinutes(dateStr, minutes) {
  const d = new Date(dateStr);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = { addMinutes };
