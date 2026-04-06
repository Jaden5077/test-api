const request = require("supertest");
const mongoose = require("mongoose");
const { google } = require("googleapis");

// Mocking dependencies BEFORE requiring the app
jest.mock("mongoose", () => {
  const originalMongoose = jest.requireActual("mongoose");
  const mockModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  return {
    ...originalMongoose,
    connect: jest.fn().mockResolvedValue(true),
    Schema: originalMongoose.Schema,
    model: jest.fn().mockReturnValue(mockModel),
  };
});

jest.mock("crypto", () => {
  return {
    ...jest.requireActual("crypto"),
    createCipheriv: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue("fakeEncrypted"),
      final: jest.fn().mockReturnValue(""),
    }),
    createDecipheriv: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue('{"accessToken":"fake"}'),
      final: jest.fn().mockReturnValue(""),
    }),
    randomBytes: jest.fn().mockReturnValue(Buffer.from("00112233445566778899aabbccddeeff", "hex")),
  };
});

jest.mock("googleapis", () => {
  const mockCalendar = {
    freebusy: {
      query: jest.fn(),
    },
    events: {
      insert: jest.fn(),
    },
  };
  const mockOAuth2Client = {
    setCredentials: jest.fn(),
    generateAuthUrl: jest.fn(),
    getToken: jest.fn(),
  };

  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => mockOAuth2Client),
      },
      calendar: jest.fn().mockReturnValue(mockCalendar),
      oauth2: jest.fn().mockReturnValue({
        userinfo: {
          get: jest.fn(),
        },
      }),
    },
  };
});

// Now require the app
const app = require("../server");

describe("POST /book-meeting", () => {
  let User;
  let calendar;

  beforeEach(() => {
    jest.clearAllMocks();
    User = mongoose.model("User");
    calendar = google.calendar();
  });

  test("Should return 400 if fields are missing", async () => {
    const response = await request(app).post("/book-meeting").send({});
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("Missing required fields");
  });

  test("Should return 400 if end time is before start time", async () => {
    const response = await request(app).post("/book-meeting").send({
      targetEmail: "test@example.com",
      startTime: "2023-10-27T11:00:00Z",
      endTime: "2023-10-27T10:00:00Z",
    });
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("Start time must be before end time");
  });

  test("Should return 404 if user is not found in database", async () => {
    User.findOne.mockResolvedValue(null);

    const response = await request(app).post("/book-meeting").send({
      targetEmail: "unknown@example.com",
      startTime: "2023-10-27T10:00:00Z",
      endTime: "2023-10-27T11:00:00Z",
    });

    expect(response.status).toBe(404);
    expect(response.body.reason).toBe("User not found in database");
  });

  test("Should return { status: 'not ok' } if time slot is busy", async () => {
    // Mock user found
    User.findOne.mockResolvedValue({
      email: "test@example.com",
      encryptedTokens: "fakeTokens",
      iv: "fakeIv",
    });

    // Mock busy slot
    calendar.freebusy.query.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [{ start: "...", end: "..." }] },
        },
      },
    });

    const response = await request(app).post("/book-meeting").send({
      targetEmail: "test@example.com",
      startTime: "2023-10-27T10:00:00Z",
      endTime: "2023-10-27T11:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("not ok");
  });

  test("Should return { status: 'ok' } if booking is successful", async () => {
    // Mock user found
    User.findOne.mockResolvedValue({
      email: "test@example.com",
      encryptedTokens: "fakeTokens",
      iv: "00112233445566778899aabbccddeeff",
    });

    // Mock free slot
    calendar.freebusy.query.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [] },
        },
      },
    });

    // Mock successful insert
    calendar.events.insert.mockResolvedValue({});

    const response = await request(app).post("/book-meeting").send({
      targetEmail: "test@example.com",
      startTime: "2023-10-27T10:00:00Z",
      endTime: "2023-10-27T11:00:00Z",
      meetingTitle: "Test Meeting",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(calendar.events.insert).toHaveBeenCalled();
  });
});
