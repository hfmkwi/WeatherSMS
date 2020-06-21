exports = function(payload, response) {
    const weebCollection = context.services.get("mongodb-atlas").db("data").collection("weebs");
    weebCollection.insertOne(EJSON.parse(payload.body.text()))
      .then(result => console.log(`Successfully inserted item with _id: ${result.insertedId}`))
      .catch(err => console.error(`Failed to insert item: ${err}`))
};
