import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

type CalendarEventArgs = {
  title: string;
  startDateTime: string;
  endDateTime: string;
};

export async function getCalendar() {
  const auth = await getAuthClient();

  return google.calendar({
    version: "v3",
    auth,
  });
}

export async function createEvent(args: CalendarEventArgs) {
  const { title, startDateTime, endDateTime } = args;

  console.log(
    `Creating Google Calendar event: title=${title}, startDateTime=${startDateTime}, endDateTime=${endDateTime}`
  );

  const calendar = await getCalendar();

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: {
        dateTime: startDateTime,
        timeZone: "Asia/Jerusalem",
      },
      end: {
        dateTime: endDateTime,
        timeZone: "Asia/Jerusalem",
      },
    },
  });

  console.log(`Google Calendar event created: ${response.data.htmlLink}`);

  return response.data;
}