import { AIMessage } from "@langchain/core/messages";

const message = new AIMessage("1");

console.log(message._printableFields);
