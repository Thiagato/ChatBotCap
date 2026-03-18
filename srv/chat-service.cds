using my.chat as chat from '../db/schema';

type QueueResponse {
  status : String;
}

service ChatService {
  entity Chats    as projection on chat.Chats;
  entity Messages as projection on chat.Messages;
  entity CsvFiles as projection on chat.CsvFiles;

  action startChat(title : String) returns Chats;
  action sendMessage(chat : UUID, question : String) returns QueueResponse;
  action uploadCsv(chat : UUID, csv : LargeString) returns String;
}